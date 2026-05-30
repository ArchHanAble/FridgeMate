// pages/add-recipe/add-recipe.ts
import { CATEGORY_INFO, DIFFICULTY, DIFFICULTY_LABELS } from '../../utils/constants'

const INGREDIENT_CATEGORIES = Object.entries(CATEGORY_INFO).map(([value, info]) => ({
  value,
  label: info.label,
  icon: info.icon,
}))

Page({
  data: {
    formData: {
      name: '',
      description: '',
      cookTime: '',
      difficulty: 'easy' as string,
      tagsText: '',
      servingsSingle: '1',
      servingsCouple: '2',
      servingsFamily: '3',
    },
    imageUrl: '',
    imageFileId: '',
    ingredients: [
      { id: 'ing_1', name: '', category: 'vegetable', amount: '', unit: '', isEssential: true },
    ] as Array<{
      id: string
      name: string
      category: string
      amount: string | number
      unit: string
      isEssential: boolean
    }>,
    steps: [{ text: '' }] as Array<{ text: string }>,
    difficulties: [
      { value: DIFFICULTY.EASY, label: DIFFICULTY_LABELS[DIFFICULTY.EASY] },
      { value: DIFFICULTY.MEDIUM, label: DIFFICULTY_LABELS[DIFFICULTY.MEDIUM] },
      { value: DIFFICULTY.HARD, label: DIFFICULTY_LABELS[DIFFICULTY.HARD] },
    ],
    ingredientCategories: INGREDIENT_CATEGORIES,
    submitting: false,
    // 食材名称自动补全
    foodNameList: [] as string[],
    activeIngIndex: -1,
    showSuggestions: false,
    filteredSuggestions: [] as string[],
  },

  onLoad() {
    this._loadFoodNames()
  },

  /** 加载冰箱食材名称列表（用于自动补全） */
  async _loadFoodNames() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getUserFoods' })
      const result = res.result as { success: boolean; data: any[] }
      if (result?.success && result.data) {
        // 去重 + 保持顺序
        const names = [...new Set(result.data.map((f: any) => f.name).filter(Boolean))]
        this.setData({ foodNameList: names })
      }
    } catch (e) {
      console.warn('加载食材名称失败:', e)
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as string
    if (!field) return
    this.setData({ [`formData.${field}`]: e.detail.value })
  },

  selectDifficulty(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value as string
    if (value) this.setData({ 'formData.difficulty': value })
  },

  /** 选择封面图并上传到云存储 */
  async chooseCover() {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      })
      const tempPath = chooseRes.tempFiles?.[0]?.tempFilePath
      if (!tempPath) return

      wx.showLoading({ title: '上传中...' })
      const app = getApp<IAppOption>()
      const openid = app.globalData?.openid || 'guest'
      const cloudPath = `recipes/${openid}_${Date.now()}.jpg`
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
      })
      wx.hideLoading()
      this.setData({
        imageUrl: tempPath,
        imageFileId: uploadRes.fileID,
      })
    } catch (e: any) {
      wx.hideLoading()
      if (e.errMsg && !String(e.errMsg).includes('cancel')) {
        wx.showToast({ title: '图片上传失败', icon: 'none' })
      }
    }
  },

  removeCover() {
    this.setData({ imageUrl: '', imageFileId: '' })
  },

  _getIngIndex(e: WechatMiniprogram.BaseEvent): number {
    const idx = e.currentTarget.dataset.ingIndex
    return idx === undefined || idx === '' ? -1 : Number(idx)
  },

  onIngredientInput(e: WechatMiniprogram.Input) {
    const index = this._getIngIndex(e)
    if (index < 0) return
    const field = e.currentTarget.dataset.field as string
    const key = `ingredients[${index}].${field}`
    this.setData({ [key]: e.detail.value })

    // 食材名称输入时触发自动补全
    if (field === 'name') {
      this._updateSuggestions(index, e.detail.value)
    }
  },

  /** 根据输入值更新建议列表 */
  _updateSuggestions(ingIndex: number, value: string) {
    if (!value || !value.trim()) {
      this.setData({ showSuggestions: false, activeIngIndex: -1, filteredSuggestions: [] })
      return
    }
    const keyword = value.trim().toLowerCase()
    const matched = this.data.foodNameList
      .filter(name => name.toLowerCase() === keyword || name.toLowerCase().includes(keyword))
      .slice(0, 8)

    this.setData({
      activeIngIndex: ingIndex,
      showSuggestions: matched.length > 0,
      filteredSuggestions: matched,
    })
  },

  /** 选择一个建议的食材名称 */
  selectSuggestion(e: WechatMiniprogram.TouchEvent) {
    const name = e.currentTarget.dataset.name as string
    const idx = this.data.activeIngIndex
    if (!name || idx < 0) return
    this.setData({
      [`ingredients[${idx}].name`]: name,
      showSuggestions: false,
      activeIngIndex: -1,
      filteredSuggestions: [],
    })
  },

  /** 关闭建议列表 */
  closeSuggestions() {
    this.setData({ showSuggestions: false, activeIngIndex: -1, filteredSuggestions: [] })
  },

  selectIngredientCategory(e: WechatMiniprogram.TouchEvent) {
    const index = this._getIngIndex(e)
    const value = e.currentTarget.dataset.value as string
    if (index < 0 || !value) return
    this.setData({ [`ingredients[${index}].category`]: value })
  },

  toggleIngredientEssential(e: WechatMiniprogram.TouchEvent) {
    const index = this._getIngIndex(e)
    if (index < 0) return
    const current = this.data.ingredients[index].isEssential
    this.setData({ [`ingredients[${index}].isEssential`]: !current })
  },

  addIngredient() {
    const list = [...this.data.ingredients, {
      id: `ing_${Date.now()}`,
      name: '', category: 'vegetable', amount: '', unit: '', isEssential: true,
    }]
    this.setData({ ingredients: list })
  },

  removeIngredient(e: WechatMiniprogram.TouchEvent) {
    const index = this._getIngIndex(e)
    if (this.data.ingredients.length <= 1) {
      wx.showToast({ title: '至少保留一种食材', icon: 'none' })
      return
    }
    const list = this.data.ingredients.filter((_, i) => i !== index)
    this.setData({ ingredients: list })
  },

  onStepInput(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ [`steps[${index}].text`]: e.detail.value })
  },

  addStep() {
    this.setData({ steps: [...this.data.steps, { text: '' }] })
  },

  removeStep(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    if (this.data.steps.length <= 1) {
      wx.showToast({ title: '至少保留一个步骤', icon: 'none' })
      return
    }
    const list = this.data.steps.filter((_, i) => i !== index)
    this.setData({ steps: list })
  },

  _validate(): boolean {
    const { formData, imageFileId, ingredients, steps } = this.data
    if (!formData.name.trim()) {
      wx.showToast({ title: '请填写菜名', icon: 'none' })
      return false
    }
    if (!imageFileId) {
      wx.showToast({ title: '请上传封面图', icon: 'none' })
      return false
    }
    const validIng = ingredients.filter((i) => i.name.trim())
    if (!validIng.length) {
      wx.showToast({ title: '请填写至少一种食材', icon: 'none' })
      return false
    }
    const validSteps = steps.filter((s) => s.text.trim())
    if (!validSteps.length) {
      wx.showToast({ title: '请填写至少一个步骤', icon: 'none' })
      return false
    }
    return true
  },

  async submitForm() {
    if (this.data.submitting) return
    if (!this._validate()) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中...' })

    const { formData, imageFileId, ingredients, steps } = this.data
    const tags = formData.tagsText
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter(Boolean)

    try {
      const res = await wx.cloud.callFunction({
        name: 'addRecipe',
        data: {
          name: formData.name.trim(),
          description: formData.description.trim(),
          cookTime: Number(formData.cookTime) || 0,
          difficulty: formData.difficulty,
          tags,
          servings: {
            single: Number(formData.servingsSingle) || 1,
            couple: Number(formData.servingsCouple) || 2,
            family: Number(formData.servingsFamily) || 3,
          },
          ingredients: ingredients.filter((i) => i.name.trim()),
          steps: steps.filter((s) => s.text.trim()),
          image: imageFileId,
        },
      })

      const result = res.result as { success?: boolean; errMsg?: string; _id?: string }
      if (result?.success) {
        wx.showToast({ title: '✨ 菜谱已添加', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1200)
      } else {
        throw new Error(result?.errMsg || '保存失败')
      }
    } catch (e: any) {
      console.error('添加菜谱失败:', e)
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
      this.setData({ submitting: false })
    } finally {
      wx.hideLoading()
    }
  },
})
