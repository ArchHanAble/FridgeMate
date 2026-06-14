// cloudfunctions/sendExpiryNotify/index.js
/**
 * 二期功能3：食材到期订阅消息推送
 * 
 * 功能：
 * 1. 检查用户即将到期的食材
 * 2. 发送微信订阅消息提醒
 * 3. 支持定时触发（云函数定时器）
 * 
 * 使用方式：
 * - 前端调用：检查当前到期情况 + 发送订阅消息
 * - 定时器触发：每天自动扫描所有用户的即将到期食材
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ==================== 配置区 ====================

/**
 * ⚠️ 订阅消息模板ID（需要在小程序管理后台申请）
 * 
 * 申请步骤：
 * 1. 登录 mp.weixin.qq.com → 订阅消息 → 公共模板库
 * 2. 搜索「到期提醒」或「物品过期」相关模板
 * 3. 选择合适的模板，获取 templateId
 * 4. 将 templateId 填入下方
 */
const DEFAULT_TEMPLATE_ID = '528n6ipGAklINTuBpISGgeDh9tg-WVA0I501THpXzAI'

/**
 * 模板字段映射（已匹配「保质期到期提醒」模板 #7153）
 * 
 * 来源：mp.weixin.qq.com → 订阅消息 → 我的模板 → 保质期到期提醒
 *   物品名称 → {{thing1.DATA}}
 *   商品数量 → {{number7.DATA}}
 *   到期日期 → {{date2.DATA}}
 *   存放位置 → {{thing4.DATA}}
 */
// ★ 字段名必须与微信后台模板中的字段完全一致
// 登录 mp.weixin.qq.com → 订阅消息 → 我的模板 → 点击详情查看字段名
// 以下字段需要和实际模板匹配，否则微信API会返回 errocde 47003
const TEMPLATE_FIELDS = {
  name: 'thing1',         // 物品名称
  quantity: 'number7',    // 商品数量（与模板字段名一致）
  expiryDate: 'date2',    // 到期日期（与模板字段名一致）
  location: 'thing4'    // 存放位置（与模板字段名一致）
}

// 默认提前几天提醒
const DEFAULT_DAYS_BEFORE = 3

// 最大单次推送条数（避免频率限制）
const MAX_PUSH_PER_REQUEST = 5


exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  // 定时触发器事件格式：{ Type: "Timer", TriggerName: "...", Time: "..." }
  // 注意：微信云开发的定时触发器使用大写 Type，不是小写 type
  const isTimerTrigger = event.Type === 'Timer' || event.type === 'timer'
  
  const {
    action: rawAction,          // check(查询) | send(发送) | batchSend(批量发送/定时器)
    daysBefore,                 // 提前多少天提醒
    templateId,                 // 自定义模板ID
    forceSend,                  // 强制发送（跳过订阅检查）
  } = event

  // 定时触发器默认走 batchSend 路由
  const action = isTimerTrigger ? 'batchSend' : (rawAction || 'check')

  console.log(`🔔 [到期提醒] action=${action}, openid=${openid}..., isTimer=${isTimerTrigger}`)
  
  switch (action) {
    case 'check':
      return await checkExpiryFoods(openid, { daysBefore })
    
    case 'send':
      return await sendExpiryNotification(openid, { daysBefore, templateId, forceSend, useHttpApi: false })
    
    case 'batchSend':
      return await batchSendNotifications(daysBefore)
    
    case 'requestSubscribe':
      // 返回模板ID供前端调用 wx.requestSubscribeMessage
      return {
        success: true,
        templateId: templateId || DEFAULT_TEMPLATE_ID,
        errMsg: '请使用此 templateId 在前端调用 wx.requestSubscribeMessage',
      }
    
    default:
      return { success: false, errMsg: `未知操作: ${action}` }
  }
}


// ==================== 核心功能 ====================

/**
 * 检查即将到期的食材
 */
async function checkExpiryFoods(openid, options = {}) {
  const { daysBefore = DEFAULT_DAYS_BEFORE } = options
  const now = new Date()
  
  try {
    // 调用 getUserFoods 云函数获取食材列表
    const res = await cloud.callFunction({
      name: 'getUserFoods',
      data: { openid }
    })
    let foods = res.result.data || []

    // 分类计算状态
    const result = {
      expired: [],        // 已过期
      expiringSoon: [],   // 即将到期（N天内）
      safe: [],           // 安全
      summary: {
        total: foods.length,
        expiredCount: 0,
        expiringCount: 0,
        safeCount: 0,
        daysBefore,
        checkDate: now.toISOString(),
      }
    }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const thresholdDate = new Date(today.getTime() + daysBefore * 24 * 60 * 60 * 1000)

    for (const food of foods) {
      if (!food.expiryDate) {
        result.safe.push(food)
        result.summary.safeCount++
        continue
      }

      const expiryDate = new Date(food.expiryDate)
      
      // 清除时间部分，只比较日期
      const expiryOnly = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate())

      if (expiryOnly < today) {
        // 已过期
        const daysExpired = Math.floor((today.getTime() - expiryOnly.getTime()) / (24 * 60 * 60 * 1000))
        result.expired.push({
          ...food,
          _status: 'expired',
          daysExpired,
          urgency: daysExpired > 7 ? 'high' : daysExpired > 3 ? 'medium' : 'low',
        })
        result.summary.expiredCount++
      } else if (expiryOnly <= thresholdDate) {
        // 即将到期
        const daysLeft = Math.ceil((expiryOnly.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
        result.expiringSoon.push({
          ...food,
          _status: 'expiringSoon',
          daysLeft,
          urgency: daysLeft === 0 ? 'high' : daysLeft <= 2 ? 'medium' : 'low',
        })
        result.summary.expiringCount++
      } else {
        result.safe.push(food)
        result.summary.safeCount++
      }
    }

    // 按紧急程度排序
    result.expired.sort((a, b) => b.daysExpired - a.daysExpired)
    result.expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft)

    console.log(`✅ [到期检查] 总${result.summary.total}项, 过期${result.summary.expiredCount}, 即将到期${result.summary.expiringCount}`)

    return {
      success: true,
      ...result,
      hasUrgentItems: result.summary.expiredCount > 0 || result.expiringSoon.filter(f => f.urgency === 'high').length > 0,
      errMsg: '',
    }
  } catch (e) {
    console.error('❌ 到期检查失败:', e)
    return { success: false, errMsg: e.message, expired: [], expiringSoon: [], safe: [] }
  }
}

/**
 * 发送单条订阅消息
 * @param {string} openid - 用户openid
 * @param {object} food - 食材数据
 * @param {string} tid - 模板ID
 */
async function pushSingleMessage(openid, food, tid, useHttpApi = false) {
  if (!tid) {
    console.warn('⚠️ 未配置模板ID，无法发送消息')
    return { success: false, reason: 'no_template' }
  }

  try {
    const now = new Date()
    const expiryDate = food.expiryDate ? new Date(food.expiryDate) : null
    
    // 构建模板数据
    // 注意：微信订阅消息 number 类型字段要求 value 为数字（正整数），不能是字符串
    const data = {}
    data[TEMPLATE_FIELDS.name] = { value: (food.name || '未知食材').substring(0, 20) }
    data[TEMPLATE_FIELDS.expiryDate] = { value: expiryDate ? formatDate(expiryDate) : '未设置' }
    data[TEMPLATE_FIELDS.location] = { value: getLocationLabel(food.location) || '冰箱' }
    // number 类型：必须是正整数（1~9999），quantity 为空或非正数时默认 1
    const quantityNum = Math.max(1, Math.min(9999, Math.floor(Number(food.quantity) || 1)))
    data[TEMPLATE_FIELDS.quantity] = { value: quantityNum }

    const sendParams = {
      touser: openid,
      templateId: tid,
      page: `pages/home/home?tab=fridge`,
      data,
      miniprogramState: 'formal',
    }

    console.log(`📤 [推送参数] touser=${openid?.substring(0,8)}..., templateId=${tid}, useHttpApi=${useHttpApi}, food=${food.name}`)

    // ★ 关键修改：只走一种 API，杜绝"云调用成功又走 HTTP 降级"导致重复推送
    let res
    if (useHttpApi) {
      // 定时触发器：直接用 HTTP API（无有效 wxCloudApiToken）
      res = await sendViaHttpApi(sendParams)
    } else {
      // 客户端触发：使用云调用（有有效 wxCloudApiToken）
      res = await cloud.openapi.subscribeMessage.send(sendParams)
    }

    console.log(`📨 [推送] ${food.name}:`, res.errCode === 0 ? '成功' : res.errMsg)
    return { success: res.errCode === 0, errCode: res.errCode, errMsg: res.errMsg }
  } catch (e) {
    console.error('❌ 推送失败:', e.message)
    console.error('❌ 推送失败详情:', JSON.stringify({ openid: openid?.substring(0,8), tid, foodName: food.name, useHttpApi }))
    return { success: false, errMsg: e.message }
  }
}

// access_token 缓存（内存级别，单次云函数执行内有效）
let _accessTokenCache = { token: '', expireAt: 0 }

/**
 * 通过 HTTP API 发送订阅消息（定时触发器降级方案）
 * 
 * 使用 appid + appsecret 获取 access_token，然后直接调用微信接口
 * 
 * 配置方式：在云开发控制台 → 云函数 → sendExpiryNotify → 配置 → 环境变量 中添加：
 *   APP_ID = 你的小程序appid
 *   APP_SECRET = 你的小程序appsecret（在 mp.weixin.qq.com → 开发管理 → 开发设置 中获取）
 */
async function sendViaHttpApi(params) {
  const { touser, templateId, page, data, miniprogramState } = params
  const axios = require('axios')

  // 1. 获取 access_token
  const accessToken = await getAccessToken(axios)

  // 2. 调用订阅消息接口
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`
  const httpRes = await axios.post(url, {
    touser,
    template_id: templateId,
    page,
    data,
    miniprogram_state: miniprogramState,
  })

  // 统一返回格式
  return {
    errCode: httpRes.data.errcode || 0,
    errMsg: httpRes.data.errmsg || 'ok',
  }
}

/**
 * 获取 access_token（带缓存）
 */
async function getAccessToken(axios) {
  // 检查缓存
  const now = Date.now()
  if (_accessTokenCache.token && _accessTokenCache.expireAt > now) {
    return _accessTokenCache.token
  }

  const appId = process.env.APP_ID || cloud.getWXContext().APPID
  const appSecret = process.env.APP_SECRET

  if (!appSecret) {
    throw new Error('未配置 APP_SECRET 环境变量，请在云开发控制台 → 云函数 → sendExpiryNotify → 配置 → 环境变量 中添加 APP_SECRET')
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
  const res = await axios.get(url)

  if (res.data.errcode) {
    throw new Error(`获取 access_token 失败: ${res.data.errmsg} (errcode: ${res.data.errcode})`)
  }

  // 缓存 token（提前5分钟过期，避免边界问题）
  _accessTokenCache = {
    token: res.data.access_token,
    expireAt: now + (res.data.expires_in - 300) * 1000,
  }

  console.log(`🔑 [access_token] 获取成功，有效期 ${res.data.expires_in}s`)
  return _accessTokenCache.token
}

/**
 * 发送到期提醒通知（给单个用户）
 */
async function sendExpiryNotification(openid, options = {}) {
  const { daysBefore = DEFAULT_DAYS_BEFORE, templateId, forceSend, useHttpApi = false } = options
  const tid = templateId || DEFAULT_TEMPLATE_ID

  // Step 1: 检查到期食材
  const checkResult = await checkExpiryFoods(openid, { daysBefore })

  if (!checkResult.success) {
    return checkResult
  }

  // 收集需要推送的食材（优先级高的先推）
  // expired 已按过期天数降序排列，expiringSoon 已按剩余天数升序排列
  const rawUrgentFoods = [
    ...checkResult.expired.slice(0, 3),        // 最多3个过期的
    ...checkResult.expiringSoon.slice(0, 2),   // 最多2个即将到期的
  ]

  // 按食物名去重：同一食材只保留最紧急的一条，避免推送两条相同的模板消息
  const seenNames = new Set()
  const urgentFoods = rawUrgentFoods.filter(food => {
    const key = (food.name || '').trim().toLowerCase()
    if (seenNames.has(key)) return false
    seenNames.add(key)
    return true
  })

  if (urgentFoods.length === 0) {
    return {
      success: true,
      pushed: 0,
      message: '🎉 太棒了！没有即将到期的食材',
      ...checkResult.summary,
    }
  }

  // Step 2: 发送订阅消息
  const results = []
  let successCount = 0

  for (const food of urgentFoods.slice(0, MAX_PUSH_PER_REQUEST)) {
    const pushRes = await pushSingleMessage(openid, food, tid, useHttpApi)
    results.push({ foodName: food.name, ...pushRes })
    if (pushRes.success) successCount++
  }

  // Step 3: 记录推送日志（可选）
  try {
    await db.collection('notify_logs').add({
      data: {
        openid,
        type: 'expiry_reminder',
        totalCount: urgentFoods.length,
        successCount,
        failCount: urgentFoods.length - successCount,
        createdAt: db.serverDate(),
      },
    })
  } catch (logErr) {
    console.warn('写入日志失败:', logErr.message)
  }

  return {
    success: true,
    pushed: successCount,
    total: urgentFoods.length,
    results,
    summary: checkResult.summary,
    errMsg: '',
  }
}

/**
 * 批量发送通知（供定时触发器使用）
 * 扫描所有有开启提醒的用户，发送到期提醒
 */
async function batchSendNotifications(daysBefore = DEFAULT_DAYS_BEFORE) {
  console.log('⏰ [定时任务] 开始批量发送到期提醒...')
  
  const startTime = Date.now()
  let totalProcessed = 0
  let totalPushed = 0

  try {
    // 获取所有开启了通知设置的用户
    // 注意：这里假设用户设置存在 user_settings 集合中
    // 如果没有独立的集合，可以改为遍历所有有食材的用户
    
    // 方案1：从 user_settings 查找开启通知的用户
    const usersRes = await db.collection('user_settings')
      .where({ notifyEnabled: true })
      .limit(100)
      .get()

    const users = usersRes.data || []

    // 按 openid 去重：避免 user_settings 中同一用户有多条记录导致重复推送
    const seenOpenids = new Set()
    const uniqueUsers = users.filter(user => {
      const oid = user._openid || user.openid
      if (!oid || seenOpenids.has(oid)) return false
      seenOpenids.add(oid)
      return true
    })

    if (uniqueUsers.length === 0) {
      console.log('⚠️ [定时任务] 没有找到开启通知的用户')
      return {
        success: true,
        processed: 0,
        pushed: 0,
        message: '没有用户开启通知',
        duration: Date.now() - startTime,
      }
    }

    console.log(`📋 [定时任务] 找到 ${uniqueUsers.length} 个开启通知的用户（去重前 ${users.length}）`)

    for (const user of uniqueUsers) {
      try {
        const userOpenid = user._openid || user.openid
        if (!userOpenid) continue

        const notifyDays = user.notifyDaysBefore || daysBefore
        const tid = user.templateId || DEFAULT_TEMPLATE_ID

        const result = await sendExpiryNotification(userOpenid, {
          daysBefore: notifyDays,
          templateId: tid,
          forceSend: true,
          useHttpApi: true,   // 定时触发器无有效 wxCloudApiToken，直接用 HTTP API
        })

        totalProcessed++
        totalPushed += result.pushed || 0

        // 避免触发频率限制，稍微延迟
        await new Promise(r => setTimeout(r, 200))
      } catch (userErr) {
        console.error(`❌ 处理用户 ${user._openid?.substring(0,8)} 失败:`, userErr.message)
      }
    }

    const duration = Date.now() - startTime
    console.log(`✅ [定时任务] 完成! 处理${totalProcessed}人, 推送${totalPushed}条, 耗时${duration}ms`)

    return {
      success: true,
      processed: totalProcessed,
      pushed: totalPushed,
      duration,
      errMsg: '',
    }
  } catch (e) {
    console.error('❌ [定时任务] 失败:', e)
    return { success: false, errMsg: e.message, processed: totalProcessed, pushed: totalPushed }
  }
}


// ==================== 工具函数 ====================

/** 格式化日期为 YYYY-MM-DD */
function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 获取存放位置的中文标签 */
function getLocationLabel(loc) {
  const map = {
    fridge: '冷藏室',
    freezer: '冷冻室',
    pantry: '常温储藏',
    other: '其他',
  }
  return map[loc] || loc || '冰箱'
}
