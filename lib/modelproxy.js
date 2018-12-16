const InterfaceManager = require('./interfacemanager');
const ProxyFactory = require('./proxyfactory');


/**
 * 模型代理
 * @class ModelProxy
 */
class ModelProxy {
  /**
   * 实例化 ModelProxy
   * @param {string|array} profile
   */
  constructor(profile) {
    const self = this;
    this._queue = []; // 请求列队

    // 处理 Api.list, Api.* 之类的字符串接口
    if (typeof profile === 'string') {
      if (/^(?:\w+\.)+\*/.test(profile)) {
        profile = ProxyFactory.getInterfaceIdsByPrefix(profile.replace(/\*$/, ''));
      } else {
        profile = [profile];
      }
    }

    // 处理 ['Api.list', 'Api2.news'] 这样的数组
    if (profile instanceof Array) {
      const prof = {};

      profile.forEach((name) => {
        const ext = name.substring(name.lastIndexOf('.') + 1);
        prof[ext] = name;
      });

      profile = prof;
    }

    // 将接口转为模型方法
    Object.keys(profile).forEach((method) => {
      self[method] = (function callee(methodName, interfaceId) {
        const proxy = ProxyFactory.create(interfaceId);
        return (params) => {
          self._queue.push({ params: params || {}, proxy });
          return self;
        };
      }(method, profile[method]));
    });
  }

  /**
   * 添加 cookie
   * @param {string} cookies
   * @returns {ModelProxy}
   */
  withCookie(cookies) {
    this._cookies = cookies;
    return this;
  }

  /**
   * 完成回调
   * @param {function} doneCallback
   * @param {function} failCallback
   * @returns {ModelProxy}
   */
  done(doneCallback, failCallback) {
    if (this._queue.length === 0) {
      return doneCallback.apply(this);
    }

    this._sendRequests(this._queue, doneCallback, failCallback);
    this._queue = []; // 清空 queue
    return this;
  }

  /**
   * 错误回调
   * @param {function} failCallback
   */
  error(failCallback) {
    this._failCallback = failCallback;
  }

  /**
   * 处理请求列队
   * @param {array} queue
   * @param {function} doneCallback
   * @param {function} failCallback
   */
  _sendRequests(queue, doneCallback, failCallback) {
    const self = this;
    const rets = [];
    let queueLength = queue.length;

    queue.forEach((it, idx) => {
      it.proxy.request(it, (data) => {
        rets[idx] = data;

        if (--queueLength === 0) {
          doneCallback.apply(self, rets);
        }
      }, (err) => {
        rets[idx] = err;

        if (--queueLength === 0) {
          doneCallback.apply(self, rets);
        }

        // TODO: 修复多接口错误回调时的BUG，待继续优化
        failCallback = failCallback || self._failCallback;

        if (typeof failCallback === 'function') {
          failCallback(err);
        } else {
          console.error(`发送请求时发生错误 [${it.proxy.opts.id}] 参数:${JSON.stringify(it.params)}`);
          console.error(err);
        }
      }, self._cookies);
    });

    self._cookies = '';
  }
}

/**
 * 初始化配置
 * @param {string} path
 */
ModelProxy.init = function init(path) {
  // 初始化错误不做处理，直接中断进程
  ProxyFactory.use(new InterfaceManager(path));
};

/**
 * 创建实例
 * @param {string|array} profile
 * @returns {ModelProxy}
 */
ModelProxy.create = function create(profile) {
  return new this(profile);
};


/**
 * 插件扩展接口
 * @param {function} profile
 * @returns {ModelProxy}
 */
ModelProxy.use = function use(plugin) {
  plugin(ModelProxy);
};


module.exports = ModelProxy; // 模型处理

ModelProxy.InterfaceManager = InterfaceManager; // 接口管理
ModelProxy.ProxyFactory = ProxyFactory; // 代理工厂
