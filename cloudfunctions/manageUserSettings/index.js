const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 管理用户设置 — 读写 user_settings 集合
 * 
 * 数据结构（user_settings 集合）：
 * {
 *   _id:           自动生成
 *   _openid:       手动写入（云函数需显式设置）
 *   notifyEnabled: boolean,     // 是否开启到期推送
 *   notifySubscribed: boolean,  // 是否已授权订阅消息
 *   notifyBeforeDays: number,   // 提前提醒天数（1/2/3/5/7）
 *   scenario:      string,      // 场景模式：single / couple / family
 *   dietPrefs: {                // 饮食偏好
 *     tastes: string[],         // 口味偏好
 *     allergies: string[],      // 忌口/过敏
 *     dietType: string,         // 饮食类型
 *   },
 *   createdAt:     Date,
 *   updatedAt:     Date,
 * }
 * 
 * action:
 *   'get'    — 读取当前用户设置（不存在则返回默认值）
 *   'update' — 更新设置（不存在则自动创建）
 *   'reset'  — 重置为默认值
 */

// 默认设置
const DEFAULT_SETTINGS = {
  notifyEnabled: false,
  notifySubscribed: false,
  notifyBeforeDays: 3,
  scenario: 'single',
  dietPrefs: {
    tastes: [],
    allergies: [],
    dietType: 'normal',
  },
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event

  if (!action) {
    return { success: false, errMsg: '缺少 action 参数' }
  }

  console.log(`🔧 [manageUserSettings] action=${action}, openid=${openid}`)

  try {
    switch (action) {
      case 'get':
        return await getSettings(openid)
      case 'update':
        return await updateSettings(openid, event.data)
      case 'reset':
        return await resetSettings(openid)
      default:
        return { success: false, errMsg: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error('❌ [manageUserSettings] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '操作失败' }
  }
}

/**
 * 读取用户设置
 * 不存在时返回默认值（不自动创建文档）
 */
async function getSettings(openid) {
  const res = await db.collection('user_settings')
    .where({ _openid: openid })
    .limit(1)
    .get()

  if (res.data && res.data.length > 0) {
    const doc = res.data[0]
    // 合并默认值（防止旧数据缺少新字段）
    const merged = { ...DEFAULT_SETTINGS, ...doc }
    console.log(`✅ [manageUserSettings] 读取成功:`, merged)
    return { success: true, data: merged, errMsg: '' }
  }

  // 数据不存在，返回默认值
  console.log(`ℹ️ [manageUserSettings] 用户无设置记录，返回默认值`)
  return { success: true, data: { ...DEFAULT_SETTINGS }, errMsg: '' }
}

/**
 * 更新用户设置
 * 文档不存在时自动创建（upsert）
 */
async function updateSettings(openid, data) {
  if (!data || typeof data !== 'object') {
    return { success: false, errMsg: '缺少更新数据' }
  }

  // 白名单过滤，防止写入非法字段
  const allowedFields = [
    'notifyEnabled', 'notifySubscribed', 'notifyBeforeDays',
    'scenario', 'dietPrefs',
  ]
  const updateData = { updatedAt: new Date() }
  for (const field of allowedFields) {
    if (data.hasOwnProperty(field)) {
      updateData[field] = data[field]
    }
  }

  // 查询是否已有记录
  const existRes = await db.collection('user_settings')
    .where({ _openid: openid })
    .limit(1)
    .get()

  if (existRes.data && existRes.data.length > 0) {
    // 更新已有文档
    const docId = existRes.data[0]._id
    await db.collection('user_settings').doc(docId).update({ data: updateData })
    console.log(`✅ [manageUserSettings] 更新成功: docId=${docId}`)
    return { success: true, message: '设置已更新', errMsg: '' }
  } else {
    // 新建文档（云函数中 _openid 不会自动注入，需手动写入）
    const newDoc = {
      _openid: openid,
      ...DEFAULT_SETTINGS,
      ...updateData,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection('user_settings').add({ data: newDoc })
    console.log(`✅ [manageUserSettings] 新建成功`)
    return { success: true, message: '设置已创建', errMsg: '' }
  }
}

/**
 * 重置用户设置为默认值
 */
async function resetSettings(openid) {
  const existRes = await db.collection('user_settings')
    .where({ _openid: openid })
    .limit(1)
    .get()

  if (existRes.data && existRes.data.length > 0) {
    const docId = existRes.data[0]._id
    await db.collection('user_settings').doc(docId).update({
      data: {
        ...DEFAULT_SETTINGS,
        updatedAt: new Date(),
      }
    })
    console.log(`✅ [manageUserSettings] 重置成功: docId=${docId}`)
  } else {
    await db.collection('user_settings').add({
      data: {
        _openid: openid,
        ...DEFAULT_SETTINGS,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    })
    console.log(`✅ [manageUserSettings] 重置并新建成功`)
  }

  return { success: true, data: { ...DEFAULT_SETTINGS }, message: '已重置为默认设置', errMsg: '' }
}
