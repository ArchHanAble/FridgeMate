const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 添加评论 — 为做菜历史记录添加评论
 * 
 * 入参：
 *   recordId - 做菜历史记录 ID
 *   content  - 评论内容
 * 
 * 数据表：cooking_history_comments
 *   字段：recordId, openid, content, createdAt
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { recordId, content } = event

  if (!recordId) {
    return { success: false, errMsg: '缺少记录 ID' }
  }

  if (!content || !content.trim()) {
    return { success: false, errMsg: '评论内容不能为空' }
  }

  if (content.length > 500) {
    return { success: false, errMsg: '评论内容不能超过 500 字' }
  }

  try {
    const now = new Date()
    const addRes = await db.collection('cooking_history_comments').add({
      data: {
        recordId,
        openid,
        content: content.trim(),
        createdAt: now,
      },
    })

    console.log(`✅ [addComment] 评论已添加, recordId=${recordId}, commentId=${addRes._id}`)

    return {
      success: true,
      comment: {
        _id: addRes._id,
        recordId,
        openid,
        content: content.trim(),
        createdAt: now,
      },
      errMsg: '',
    }

  } catch (err) {
    console.error('❌ [addComment] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '添加评论失败' }
  }
}
