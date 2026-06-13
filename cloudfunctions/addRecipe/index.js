// cloudfunctions/addRecipe/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 添加菜谱到 recipes 集合
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const {
      name,
      description = '',
      cookTime = 0,
      difficulty = 'easy',
      tags = [],
      servings,
      ingredients = [],
      steps = [],
      image = '',
      likes = 0,
      nutrition = null,
    } = event

    // ====== 调试日志 ======
    console.log('[addRecipe] 开始处理菜谱添加请求')
    console.log(`[addRecipe] 菜名: ${name}`)
    console.log(`[addRecipe] image 类型: ${typeof image}`)
    console.log(`[addRecipe] image 长度: ${image ? String(image).length : 0}`)
    console.log(`[addRecipe] image 前100字符: ${image ? String(image).substring(0, 100) : '空'}`)

    if (!name || !String(name).trim()) {
      return { success: false, errMsg: '请填写菜名' }
    }
    if (!image || !String(image).trim()) {
      console.error('[addRecipe] ❌ image 为空!')
      return { success: false, errMsg: '请上传封面图' }
    }

    // 检查 image 大小（Base64 编码后约 1/3 增长）
    const imageSizeKB = Math.round(String(image).length / 1024)
    console.log(`[addRecipe] image 数据大小: ${imageSizeKB} KB`)
    if (imageSizeKB > 900) {
      console.error(`[addRecipe] ⚠️ image 数据过大(${imageSizeKB}KB)，可能超过数据库限制!`)
    }
    if (!ingredients.length) {
      return { success: false, errMsg: '请至少添加一种食材' }
    }
    if (!steps.length) {
      return { success: false, errMsg: '请至少添加一个步骤' }
    }

    const normalizedIngredients = ingredients
      .filter((ing) => ing && ing.name && String(ing.name).trim())
      .map((ing) => ({
        name: String(ing.name).trim(),
        category: ing.category || 'other',
        amount: ing.amount !== undefined && ing.amount !== '' ? ing.amount : '适量',
        unit: (ing.unit || '').trim(),
        isEssential: ing.isEssential !== false,
      }))

    const normalizedSteps = steps
      .filter((s) => s && s.text && String(s.text).trim())
      .map((s, idx) => ({
        order: idx + 1,
        text: String(s.text).trim(),
      }))

    if (!normalizedIngredients.length) {
      return { success: false, errMsg: '请至少添加一种有效食材' }
    }
    if (!normalizedSteps.length) {
      return { success: false, errMsg: '请至少添加一个有效步骤' }
    }

    // === 查找用户所在的共享冰箱组 ===
    let groupId = null
    try {
      const fridgeRes = await db.collection('shared_fridges')
        .where({
          $or: [
            { ownerOpenId: openid },
            { 'members.openId': openid }
          ]
        })
        .limit(1)
        .get()
      if (fridgeRes.data && fridgeRes.data.length > 0) {
        groupId = fridgeRes.data[0]._id
      }
    } catch (e) {
      console.warn('共享组查询失败，继续以个人方式添加:', e.message)
    }

    const now = new Date()
    const dataToSave = {
      _openid: openid,
      groupId: groupId, // 共享组 ID（非共享用户为 null）
      name: String(name).trim(),
      description: String(description || '').trim(),
      cookTime: Number(cookTime) || 0,
      difficulty: difficulty || 'easy',
      tags: Array.isArray(tags) ? tags : [],
      servings: servings || { single: 1, couple: 2, family: 3 },
      ingredients: normalizedIngredients,
      steps: normalizedSteps,
      image: String(image).trim(),
      likes: Number(likes) || 0,
      nutrition: nutrition || null,
      source: 'user',
      createdAt: now,
      updatedAt: now,
    }

    // ====== 写入前日志 ======
    console.log(`[addRecipe] 准备写入数据库，dataToSave.image 长度: ${dataToSave.image.length}`)

    let res
    try {
      res = await db.collection('recipes').add({ data: dataToSave })
      console.log(`[addRecipe] ✅ 写入成功! _id: ${res._id}`)
    } catch (dbError) {
      console.error('[addRecipe] ❌ 数据库写入失败:', dbError)
      throw dbError
    }

    return {
      success: true,
      _id: res._id,
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ 添加菜谱失败:', err)
    return { success: false, errMsg: err.message || '添加失败' }
  }
}
