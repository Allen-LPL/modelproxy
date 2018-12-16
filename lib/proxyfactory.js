const url = require('url');
const http = require('http');
const mock = require('mockjs');
const Agent = require('agentkeepalive');

const InterfaceManager = require('./interfacemanager');

const STATUS_MOCK = 'mock'; // 处理接口 response 字段数据
const STATUS_MOCK_ERR = 'mockerr'; // 处理接口 responseError 字段数据
const ENCODING_RAW = 'raw'; // 返回二进制数据

let interfaceManager = null; // 全局接口配置缓存

const keepaliveAgent = new Agent({
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketKeepAliveTimeout: 30000, // free socket keepalive for 30 seconds
});

/**
 * 代理类
 * @class Proxy
 */
class Proxy {
  /**
   * 实例化 Proxy
   * @param {Object} options
   */
  constructor(options) {
    this.opts = options || {};
    this.urls = options.urls || {};

    if (options.status === STATUS_MOCK) {
      return;
    }

    const currUrl = this.urls[options.status];

    if (!currUrl) {
      throw new Error(`[urls] 中没有配置${options.status}状态!`);
    }

    const urlObj = url.parse(currUrl);
    this.opts.hostname = urlObj.hostname;
    this.opts.port = urlObj.port || 80;
    this.opts.path = urlObj.path;
    this.opts.method = (this.opts.method || 'GET').toUpperCase();
  }

  /**
   * 代理请求核心方法
   *
   * @param {Object} reqObj 请求参数
   * @param {function} doneCallback 成功回调
   * @param {function} failCallback 成功回调
   * @param {string} cookie
   */
  request(reqObj, doneCallback, failCallback, cookie) {
    const self = this;
    const params = reqObj.params;

    // mock 处理
    if (this.opts.status === STATUS_MOCK || this.opts.status === STATUS_MOCK_ERR) {
      return this.mockRequest(params, doneCallback, failCallback);
    }

    // 请求参数
    const options = {
      hostname: self.opts.hostname,
      port: self.opts.port,
      path: self.opts.path,
      method: self.opts.method,
      agent: keepaliveAgent, // Keep-Alive
      headers: {},
    };

    const querystring = self.queryStringify(params);

    if (self.opts.method === 'POST') {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = querystring.length;
    } else if (self.opts.method === 'GET') {
      if (querystring !== '') {
        options.path += `?${querystring}`;
      }
      options.headers['Content-Type'] = 'application/json;charset=UTF-8';
    }

    if (cookie) {
      options.headers.Cookie = cookie;
    }

    let duration = +new Date(); // 接口响应时间

    let req;

    // 超时控制
    const reqTimeout = setTimeout(() => {
      req && req.abort();
    }, self.opts.timeout || 4500);

    req = http.request(options, (res) => {
      const chunks = [];
      let resCode = res.statusCode || 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        duration = new Date() - duration; // 接口响应时间
        clearTimeout(reqTimeout);
        const buffer = Buffer.concat(chunks);

        if (self.opts.encoding === ENCODING_RAW) { // 二进制
          doneCallback(buffer);
        } else {
          let result = buffer.toString('utf8'); // 强制规定数据为utf8

          if (self.opts.dataType !== 'json') { // 文本
            doneCallback(result);
          } else {
            // html 检测 + 去除
            if (result[0] === '<') { // 排除 ngix 跟 thinkphp 直接报错
              resCode = 0; // JSON解析错误
              failCallback(new Error('JSON解析错误'));
            } else {
              // 去除 json 数据末尾错误信息
              const pos = result.lastIndexOf('<!DOCTYPE');

              if (pos > -1) {
                resCode = 2; // 不纯净的JSON数据
                result = result.substring(0, pos);
              }

              // 在执行成功回调的时候也有可能抛出异常，这里获取的异常就不是json解析异常， 所以将成功回调放到整个try catch之后 20180129
              // 在logs中的数据中捕获到大量json解析异常的错误日志，但是发现返回的数据是正常的json数据，产生的错误是在成功回调中抛出的异常 "can't set header after they are sent"
              try {
                result = JSON.parse(result); // JSON解析
              } catch (error) {
                resCode = 0; // JSON解析错误
                return failCallback(error);
              }
              doneCallback(result);
            }
          }
        }

        self.log({ // 日志功能
          id: self.opts.id,
          url: `http://${options.hostname}${options.path}`,
          params, // 接口参数
          cookie, // 接口 cookies
          duration, // 接口响应时间
          resCode, // 接口状态码
          data: buffer.toString('utf8'), // 接口返回数据
        });
      });
    });

    req.on('error', (err) => {
      failCallback(err);
      self.log({ // 日志功能
        id: self.opts.id,
        url: `http://${options.hostname}${options.path}`,
        params, // 接口参数
        cookie, // 接口 cookies
        duration, // 接口响应时间
        resCode: 1, // 接口状态码
        data: err.message, // 错误信息
      });
    });

    // 超时控制
    // req.setTimeout(self.opts.timeout || 4500, () => {
    //   console.log('duration timeout', Date.now() - duration);
    //   if (req) {
    //     req.abort();
    //     // const e = new Error('ESOCKETTIMEDOUT');
    //     // e.code = 'ESOCKETTIMEDOUT';
    //     // e.connect = false;
    //     // req.emit('error', e);
    //   }
    // });

    if (self.opts.method === 'POST') {
      req.write(querystring);
    }

    req.end();

    return true;
  }

  /**
   * mock 请求
   * @param {Object} params
   * @param {function} doneCallback
   * @param {function} failCallback
   */
  mockRequest(params, doneCallback, failCallback) {
    try {
      if (!this.rule) {
        this.rule = interfaceManager.getRule(this.opts.id);
      }

      if (this.opts.isRuleStatic) { // 静态，直接返回
        return doneCallback(
          this.opts.status === STATUS_MOCK
          ? this.rule.response
          : this.rule.responseError);
      }

      // mockjs 处理
      doneCallback(
        this.opts.status === STATUS_MOCK
        ? mock.mock(this.rule.response)
        : mock.mock(this.rule.responseError));
    } catch (err) {
      failCallback(err);
    }

    return true;
  }

  /**
   * queryString 编码
   * @param {Object} params
   * @returns {string}
   */
  queryStringify(params) {
    if (!params || typeof params === 'string') {
      return params || '';
    } else if (params instanceof Array) {
      return params.join('&');
    }

    const qs = [];
    let val = '';

    Object.keys(params).forEach((key) => {
      try {
        val = typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key];
        qs.push(`${key}=${encodeURIComponent(val)}`);
      } catch (error) {
        // 忽略无法解析参数
      }
    });

    return qs.join('&');
  }

  /**
   * 日志接口，需要扩展覆盖重写
   * @param {object} data
   */
  log() {
    // 处理你的日志吧
  }
}

// 代理助手
const ProxyFactory = {
  proxies: {}, // 代理实例缓存对象

  /**
   * 初始化加载配置
   * @param {any} ifmgr
   * @returns
   */
  use(ifmgr) {
    if (ifmgr instanceof InterfaceManager) {
      interfaceManager = ifmgr;
    } else {
      throw new Error('接口对象必须是 InterfaceManager 的实例!');
    }

    return this;
  },

  /**
   * 创建接口代理实例
   * @param {string} interfaceId
   * @returns {Proxy}
   */
  create(id) {
    if (this.proxies[id]) {
      return this.proxies[id];
    }

    const options = interfaceManager.getProfile(id);

    if (!options) {
      throw new Error(`无效的接口 id: ${id}`);
    }

    this.proxies[id] = new Proxy(options);

    return this.proxies[id];
  },

  /**
   * 根据前缀匹配接口
   * @param {string} pattern 批量匹配 (例如 Api.*)
   * @returns {array}
   */
  getInterfaceIdsByPrefix(pattern) {
    return interfaceManager.getInterfaceIdsByPrefix(pattern);
  },

  // TODO Interceptor 拦截器
};

module.exports = ProxyFactory;
ProxyFactory.Proxy = Proxy; // 暴露接口用于复写扩展功能
