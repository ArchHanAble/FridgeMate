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

    if (!name || !String(name).trim()) {
      return { success: false, errMsg: '请填写菜名' }
    }
    if (!image || !String(image).trim()) {
      return { success: false, errMsg: '请上传封面图' }
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

    const now = new Date()
    const dataToSave = {
      _openid: openid,
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

    const res = await db.collection('recipes').add({ data: dataToSave })

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
