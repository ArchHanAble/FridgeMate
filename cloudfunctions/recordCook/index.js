// cloudfunctions/recordCook/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 标记做过 / 删除记录 — 统一入口
 *
 * 入参：
 *   - action?: string    操作类型：'delete' 删除记录，其他/不传 为创建记录
 *
 * 创建记录（默认）：
 *   - recipeId: string    菜谱 ID
 *   - recipeName: string  菜名
 *   - image: string       菜谱封面图 URL（可选）
 *   - ingredients?: string[]  消耗的食材列表（可选）
 *   - experience?: string  做菜心得分享（可选）
 *   - cookedAt?: string    做菜日期（可选，格式：YYYY-MM-DD，默认当天）
 *
 * 删除记录：
 *   - _id: string         要删除的记录 ID
 *
 * 返回：
 *   - success, errMsg
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const { action } = event

  // 删除操作
  if (action === 'delete') {
    return handleDelete(event, openid)
  }

  // 默认：创建做菜记录
  return handleCreate(event, openid)
}

/**
 * 删除做菜记录
 */
async function handleDelete(event, openid) {
  const { _id } = event

  if (!_id) {
    return { success: false, errMsg: '记录ID不能为空' }
  }

  console.log(`🗑️ 删除做菜记录: id=${_id}, openid=${openid}`)

  try {
    await db.collection('cooking_history').doc(_id).remove()
    console.log(`✅ 做菜记录已删除: id=${_id}`)
    return { success: true, message: '删除成功' }
  } catch (err) {
    console.error('❌ 删除做菜记录失败:', err)
    return { success: false, errMsg: err.message || '删除失败' }
  }
}

/**
 * 创建做菜记录（原有逻辑）
 */
async function handleCreate(event, openid) {
  const { recipeId, recipeName, image, ingredients, experience, cookedAt } = event

  // 必填校验
  if (!recipeName || !recipeName.trim()) {
    return { success: false, errMsg: '菜谱名称不能为空' }
  }

  console.log(`📝 记录做菜: 「${recipeName}」 by ${openid}`)

  // 解析做菜日期（默认当天）
  let cookDate = new Date()
  
  if (cookedAt && typeof cookedAt === 'string') {
    // 支持 YYYY-MM-DD 格式
    // 获取当前系统时间（小时、分钟、秒）
    const now = new Date()
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    const timeStr = `${hours}:${minutes}:${seconds}`
    
    // 将用户传入的日期与当前时间拼接，形成完整的日期时间
    const parsed = new Date(cookedAt + 'T' + timeStr)
    if (!isNaN(parsed.getTime())) {
      cookDate = parsed
    }
  }

  try {
    // 写入 cooking_history 集合
    const res = await db.collection('cooking_history').add({
      data: {
        _openid: openid,
        recipeId: recipeId || '',
        recipeName: recipeName.trim(),
        image: image || '',           // 存储图片URL方便直接展示
        experience: experience || '',  // 做菜心得分享
        consumedIngredients: ingredients || [],
        missingInFridge: [],           // 轻量模式不扣食材，此字段为空
        source: 'manual',             // 标记来源：手动记录（区别于 consumeIngredients 的 auto）
        cookedAt: cookDate,           // 做菜日期（可自定义）
        createdAt: new Date(),
      },
    })

    console.log(`✅ 做菜记录已保存: id=${res._id}`)

    return {
      success: true,
      _id: res._id,
      message: `「${recipeName.trim()}」已加入做菜历史`,
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ 记录做菜失败:', err)
    return { success: false, errMsg: err.message || '服务器内部错误' }
  }
}
