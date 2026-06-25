// cloudfunctions/deleteRecipe/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 删除菜谱云函数
 * 参数：recipeId - 菜谱ID
 * 返回：{ success: boolean, message?: string, error?: string }
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { recipeId } = event

  if (!recipeId) {
    return { success: false, error: '缺少菜谱ID参数' }
  }

  try {
    // 查询菜谱是否存在并验证所有权
    const doc = await db.collection('recipes').doc(recipeId).get()

    if (!doc.data) {
      return { success: false, error: '菜谱不存在，可能已被删除' }
    }

    

    // 执行删除
    await db.collection('recipes').doc(recipeId).remove()

    console.log(`[deleteRecipe] 菜谱已成功删除: ${recipeId} (${doc.data.name})`)
    return {
      success: true,
      message: '菜谱已删除',
    }
  } catch (err) {
    console.error('[deleteRecipe] 删除菜谱失败:', err)

    // 处理记录不存在的错误
    if (err.errCode === -1 || (err.message && err.message.includes('not found'))) {
      return { success: false, error: '菜谱不存在' }
    }

    return {
      success: false,
      error: err.message || '删除失败，请稍后重试',
    }
  }
}
