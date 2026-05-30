const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 解散共享冰箱 — 仅允许 owner 操作
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { groupId } = event

  if (!groupId) {
    return { success: false, errMsg: '缺少 groupId' }
  }

  console.log(`🗑️ [dissolveFridge] 开始, openid=${openid}, groupId=${groupId}`)

  try {
    // === Step 1: 查找共享组，验证 owner 身份 ===
    const fridgeRes = await db.collection('shared_fridges')
      .doc(groupId)
      .get()

    if (!fridgeRes.data) {
      return { success: false, errMsg: '共享组不存在' }
    }

    const fridge = fridgeRes.data

    // 验证当前用户是否是 owner
    if (fridge.ownerOpenId !== openid) {
      return { success: false, errMsg: '只有管理员才能解散冰箱' }
    }

    // === Step 2: 删除共享组 ===
    await db.collection('shared_fridges').doc(groupId).remove()

    console.log(`✅ [dissolveFridge] 共享组已删除: ${groupId}`)

    return {
      success: true,
      message: '冰箱已解散',
      errMsg: '',
    }

  } catch (err) {
    console.error('❌ [dissolveFridge] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '解散失败' }
  }
}
