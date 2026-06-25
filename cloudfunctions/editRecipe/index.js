// cloudfunctions/editRecipe/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 编辑菜谱 — 更新 recipes 集合中已有记录
 * 接收菜谱ID及更新后的数据，校验后更新记录，返回成功/失败状态
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const {
      recipeId,
      name,
      description = '',
      cookTime = 0,
      difficulty = 'easy',
      tags = [],
      servings,
      ingredients = [],
      steps = [],
      image = '',
    } = event

    // ====== 1. 校验 recipeId ======
    if (!recipeId) {
      return { success: false, errMsg: '缺少菜谱ID' }
    }

    // ====== 2. 查找已有菜谱 ======
    let recipe
    try {
      const recipeRes = await db.collection('recipes').doc(recipeId).get()
      recipe = recipeRes.data
    } catch (e) {
      return { success: false, errMsg: '菜谱不存在' }
    }

    if (!recipe) {
      return { success: false, errMsg: '菜谱不存在' }
    }

    // ====== 3. 权限校验：只允许菜谱作者或共享组成员编辑 ======
    if (recipe._openid !== openid) {
      let hasAccess = false
      if (recipe.groupId) {
        try {
          const fridgeRes = await db.collection('shared_fridges').doc(recipe.groupId).get()
          const fridge = fridgeRes.data
          if (fridge) {
            if (fridge.ownerOpenId === openid) {
              hasAccess = true
            } else if (Array.isArray(fridge.members) && fridge.members.some(m => m.openId === openid)) {
              hasAccess = true
            }
          }
        } catch (e) {
          console.warn('[editRecipe] 共享组查询失败:', e.message)
        }
      }

      if (!hasAccess) {
        return { success: false, errMsg: '无权编辑该菜谱' }
      }
    }

    // ====== 4. 校验必填字段 ======
    if (!name || !String(name).trim()) {
      return { success: false, errMsg: '请填写菜名' }
    }
    if (!Array.isArray(ingredients) || !ingredients.length) {
      return { success: false, errMsg: '请至少添加一种食材' }
    }
    if (!Array.isArray(steps) || !steps.length) {
      return { success: false, errMsg: '请至少添加一个步骤' }
    }

    // ====== 5. 规范化食材数据 ======
    const normalizedIngredients = ingredients
      .filter((ing) => ing && ing.name && String(ing.name).trim())
      .map((ing) => ({
        name: String(ing.name).trim(),
        category: ing.category || 'other',
        amount: ing.amount !== undefined && ing.amount !== '' ? ing.amount : '适量',
        unit: (ing.unit || '').trim(),
        isEssential: ing.isEssential !== false,
      }))

    if (!normalizedIngredients.length) {
      return { success: false, errMsg: '请至少添加一种有效食材' }
    }

    // ====== 6. 规范化步骤数据 ======
    const normalizedSteps = steps
      .filter((s) => s && s.text && String(s.text).trim())
      .map((s, idx) => ({
        order: idx + 1,
        text: String(s.text).trim(),
      }))

    if (!normalizedSteps.length) {
      return { success: false, errMsg: '请至少添加一个有效步骤' }
    }

    // ====== 7. 构建更新数据 ======
    const now = new Date()
    const updateData = {
      name: String(name).trim(),
      description: String(description || '').trim(),
      cookTime: Number(cookTime) || 0,
      difficulty: difficulty || 'easy',
      tags: Array.isArray(tags) ? tags : [],
      servings: servings || recipe.servings || { single: 1, couple: 2, family: 3 },
      ingredients: normalizedIngredients,
      steps: normalizedSteps,
      updatedAt: now,
    }

    // 如果传入了新封面图（Base64），则更新 image 字段
    if (image && String(image).trim()) {
      const imageStr = String(image).trim()
      console.log(`[editRecipe] 更新封面图，长度: ${imageStr.length}`)
      updateData.image = imageStr
    }

    // ====== 8. 写入数据库 ======
    console.log(`[editRecipe] 更新菜谱 ${recipeId}: ${updateData.name}`)
    await db.collection('recipes').doc(recipeId).update({ data: updateData })

    console.log(`[editRecipe] ✅ 菜谱编辑成功: ${recipeId}`)
    return {
      success: true,
      message: '菜谱编辑成功',
    }
  } catch (err) {
    console.error('[editRecipe] ❌ 编辑菜谱失败:', err)
    return {
      success: false,
      errMsg: err.message || '编辑失败，请稍后重试',
    }
  }
}
