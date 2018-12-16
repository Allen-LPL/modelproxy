const fs = require('fs');


/**
 * 接口管理类
 * @class InterfaceManager
 */
class InterfaceManager {
  /**
   * 实例化 erfaceManager.
   * @param {string} file
   */
  constructor(file) {
    this.file = file; // 配置文件路径
    this.map = {}; // 解析后的接口

    if (typeof file === 'string') {
      this.rulebase = file.replace(/\/[^/]+$/, '/interfaceRules');
      this.loadProfilesFromFile(file);
    } else {
      this.rulebase = './interfaceRules';
      this.loadProfiles(file);
    }
  }

  /**
   * 加载解析配置
   * @param {string} file
   * @throws
   */
  loadProfilesFromFile(file) {
    let profiles;

    try {
      profiles = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new Error(`文件加载失败: ${err.message}`);
    }

    try {
      profiles = JSON.parse(profiles);
    } catch (err) {
      throw new Error(`数据解析失败:${err.message}`);
    }

    this.loadProfiles(profiles);
  }

  /**
   * 加载解析配置
   * @param {object} profiles
   * @throws
   */
  loadProfiles(profiles) {
    // mock 配置中的 mock文件路径
    // TODO 修复路径解析BUG
    this.rulebase = profiles.rulebase ? profiles.rulebase.replace(/\/$/, '') : this.rulebase; // 转为绝对路径

    // mock 引擎
    this.engine = profiles.engine || 'mockjs';

    if (profiles.status === undefined) {
      throw new Error('在接口配置中没有指定的状态!');
    }

    // 状态
    this.status = profiles.status;

    // 接口处理
    const interfaces = profiles.interfaces || [];
    for (let i = interfaces.length - 1; i >= 0; i--) {
      if (this.addProfile(interfaces[i])) {
        console.log(`* Interface [${interfaces[i].id}] is load success.`);
      } else {
        console.log(`* Interface [${interfaces[i].id}] is load failed.`);
      }
    }
  }

  /**
   * 获取接口配置
   * @param {string} id interfaceId
   * @returns {Object} profile
   */
  getProfile(id) {
    return this.map[id];
  }

  /**
   * 解析添加配置到 map
   * @param {object} prof
   * @returns {boolean}
   */
  addProfile(prof) {
    if (!prof || !prof.id) {
      console.log('不能添加没有ID的接口配置!');
      return false;
    }

    // id 规范检测
    if (!/^(?:\w+\.)*\w+$/.test(prof.id)) {
      console.log(`无效 id: ${prof.id}`);
      return false;
    }

    // 重复性检测
    if (this.map[prof.id]) {
      console.log(`不能重复添加接口 [${prof.id}]!`);
      return false;
    }

    // url字段检测
    if (!this.isUrlsValid(prof.urls)) {
      console.log(`接口 [${prof.id}] urls 字段配置无效!`);
      return false;
    }

    // 接口的 mock 文件
    prof.ruleFile = `${this.rulebase}/${prof.ruleFile || (`${prof.id}.rule.json`)}`;


    // 每个接口单独状态配置
    if (!(prof.status in prof.urls || prof.status === 'mock' || prof.status === 'mockerr')) {
      prof.status = this.status;
    }

    // 其他配置
    prof.method = (prof.method || 'GET').toUpperCase();
    prof.dataType = (prof.dataType || 'json').toLowerCase(); // 返回的数据格式
    prof.isRuleStatic = Boolean(prof.isRuleStatic); // mock文件是否为静态，true则直接返回
    prof.isCookieNeeded = Boolean(prof.isCookieNeeded); // 是否需要传递cookie默认false
    prof.timeout = prof.timeout || 4500; // 延时设置
    // prof.format
    // prof.filter         = ...

    this.map[prof.id] = prof;
    return true;
  }

  /**
   * urls 字段有性验证
   * @param {object} urls
   * @returns {boolean}
   */
  isUrlsValid(urls) {
    if (!urls) return false;

    let ret = false;
    Object.keys(urls).forEach((k) => { // 处理末尾的 / 符号
      urls[k] = urls[k].replace(/\/$/, '');
      ret = true;
    });

    return ret;
  }

  /**
   * 根据前缀匹配接口
   * @param {string} pattern 批量匹配 (例如 Api.*)
   * @returns {array}
   */
  getInterfaceIdsByPrefix(pattern) {
    if (!pattern) {
      return [];
    }

    const ids = [];
    const map = this.map;
    const len = pattern.length;

    Object.keys(map).forEach((id) => {
      if (id.slice(0, len) === pattern) {
        ids.push(id);
      }
    });

    return ids;
  }

  /**
   * 获取接口的mock文件
   * @param {string} id
   * @returns {object}
   */
  getRule(id) {
    if (!id || !this.map[id]) {
      throw new Error(`接口 [${id}] 配置不存在！`);
    }

    const path = this.map[id].ruleFile;
    if (!fs.existsSync(path)) {
      throw new Error(`接口 [${id}] mock数据不存在！\n路径: ${path}`);
    }

    let rulefile;

    try {
      rulefile = fs.readFileSync(path, 'utf8');
    } catch (err) {
      throw new Error(`接口 [${id}] mock数据读取失败！\n路径: ${path}`);
    }

    try {
      // TODO 改为 json js 兼容模式
      return JSON.parse(rulefile);
    } catch (err) {
      throw new Error(`接口 [${id}] mock数据解析错误！ \n${err.message}\n路径: ${path}`);
    }
  }
}

module.exports = InterfaceManager;
