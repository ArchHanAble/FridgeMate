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
    qiniuImageUrl: '',
    // Base64 图片数据（用于直接存储到数据库）
    base64ImageData: '',
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

  /** 选择封面图 - Base64 存数据库方案 */
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

      wx.showLoading({ title: '处理中...' })

      // ====== 图片压缩（防止 Base64 超出数据库限制）======
      // 微信云数据库单字段限制约 1MB，需要压缩图片确保 base64 不超限
      let finalPath = tempPath
      try {
        const compressRes = await wx.compressImage({
          src: tempPath,
          quality: 50,  // 降低到 50%，更激进压缩
          compressedWidth: 600,  // 进一步减小尺寸
          compressedHeight: 600,
        })
        finalPath = compressRes.tempFilePath
        console.log('[chooseCover] 图片压缩成功:', tempPath, '->', finalPath)
      } catch (compressErr: any) {
        console.warn('[chooseCover] 压缩失败，使用原图:', compressErr)
      }

      // 读取本地图片文件转为 base64
      const fs = wx.getFileSystemManager()
      let base64Data = ''
      try {
        const fileData = fs.readFileSync(finalPath, 'base64')
        base64Data = typeof fileData === 'string' ? fileData : ''
      } catch (readErr: any) {
        console.warn('readFileSync 失败，尝试异步方式:', readErr)
        // 兼容处理：部分环境下 readFileSync 可能不可用
        base64Data = await new Promise<string>((resolve, reject) => {
          fs.readFile({
            filePath: finalPath,
            encoding: 'base64',
            success(fileRes: any) { resolve(String(fileRes.data)) },
            fail(err: any) { reject(err) }
          })
        })
      }

      // 检查 base64 大小（警告但允许继续）
      const estimatedSizeKB = Math.round(base64Data.length * 3 / 4 / 1024)
      console.log(`[chooseCover] Base64 预估大小: ${estimatedSizeKB} KB`)
      if (estimatedSizeKB > 900) {  // 接近 1MB 限制时警告
        console.warn(`[chooseCover] ⚠️ Base64 数据较大(${estimatedSizeKB}KB)，可能接近数据库限制`)
      }

      // ====== Base64 存数据库方案（当前使用）======
      // 直接将 base64 数据保存到 data，提交时存入数据库
      // 优点：所有用户都能查看，无权限问题
      // 缺点：数据量较大，占用数据库存储
      this.setData({
        imageUrl: tempPath,           // 本地路径用于预览（显示原图）
        base64ImageData: base64Data,  // Base64 数据用于提交保存（使用压缩后的）
        qiniuImageUrl: '',            // 清空七牛云 URL
      })

      // ====== 七牛云上传方案（已注释保留）======
      // 调用 uploadToQiniu 云函数上传到七牛云
      /*
      const uploadRes = await wx.cloud.callFunction({
        name: 'uploadToQiniu',
        data: {
          imageBase64: base64Data,
          folder: 'recipes',
          fileName: `${Date.now()}.jpg`,
        },
      })

      wx.hideLoading()
      const result = uploadRes.result as { success?: boolean; url?: string; errMsg?: string }

      if (result?.success && result?.url) {
        this.setData({
          imageUrl: tempPath,       // 本地路径用于预览
          qiniuImageUrl: result.url, // 七牛云 URL 用于提交保存
        })
      } else {
        throw new Error(result?.errMsg || '上传失败')
      }
      */

      wx.hideLoading()
    } catch (e: any) {
      wx.hideLoading()
      if (e.errMsg && !String(e.errMsg).includes('cancel')) {
        console.error('封面图处理失败:', e)
        wx.showToast({ title: e.message || '图片处理失败', icon: 'none' })
      }
    }
  },

  removeCover() {
    this.setData({ imageUrl: '', qiniuImageUrl: '', base64ImageData: '' })
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
    const { formData, base64ImageData, ingredients, steps } = this.data
    if (!formData.name.trim()) {
      wx.showToast({ title: '请填写菜名', icon: 'none' })
      return false
    }
    // Base64 方案：检查 base64ImageData
    // 七牛云方案（已注释）：检查 qiniuImageUrl
    if (!base64ImageData) {
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

    const { formData, base64ImageData, ingredients, steps } = this.data
    const tags = formData.tagsText
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter(Boolean)

    try {
      // ====== Base64 存数据库方案（当前使用）======
      // 将 base64 数据直接存入数据库，格式：data:image/jpeg;base64,xxxxx
      console.log('[submitForm] 准备提交菜谱...')
      console.log(`[submitForm] base64ImageData 长度: ${base64ImageData?.length || 0}`)
      console.log(`[submitForm] base64ImageData 前50字符: ${base64ImageData?.substring(0, 50)}...`)

      if (!base64ImageData || !base64ImageData.trim()) {
        throw new Error('图片数据为空，请重新选择封面图')
      }

      // 检查 base64 大小（警告）
      const estimatedSizeKB = Math.round(base64ImageData.length * 3 / 4 / 1024)
      console.log(`[submitForm] Base64 预估大小: ${estimatedSizeKB} KB`)
      if (estimatedSizeKB > 800) {
        console.warn(`[submitForm] ⚠️ Base64 数据较大(${estimatedSizeKB}KB)，可能导致存储失败`)
      }

      const imageBase64 = `data:image/jpeg;base64,${base64ImageData}`
      console.log(`[submitForm] 完整 image 字段长度: ${imageBase64.length}`)

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
          image: imageBase64, // Base64 图片数据（所有用户可访问）
          // ====== 七牛云方案（已注释保留）======
          // image: qiniuImageUrl, // 七牛云 URL
        },
      })

      // 打印返回结果用于调试
      console.log('[submitForm] addRecipe 返回:', JSON.stringify(res.result))

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
