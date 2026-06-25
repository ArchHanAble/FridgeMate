// pages/cook-history/cook-history.ts
// 做菜历史页面 — 时间轴样式布局

interface ConsumedIngredient {
  name: string              // 食材名称
  amount: number            // 消耗数量
  unit: string              // 单位（可选）
}

interface CookRecord {
  _id: string
  recipeId: string          // 关联的菜谱 ID
  name: string              // 菜名
  image: string             // 做菜图片（用户上传或菜谱封面）
  experience: string        // 做菜心得分享
  cookedAt: number          // 做菜时间戳 (ms)
  dateStr: string           // 格式化的日期 "2026-04-11"
  consumedIngredients: ConsumedIngredient[]  // 消耗的食材列表（含名称和数量）
  ingredientsExpanded?: boolean  // 食材详情是否展开
  experienceExpanded?: boolean  // 心得是否展开
}

interface CommentItem {
  _id: string
  recordId: string
  openid: string
  content: string
  createdAt: Date | number
  nickName: string
  avatarUrl: string
}

interface RecipeOption {
  _id: string
  name: string
  image: string
}

Page({
  data: {
    // === 搜索与筛选 ===
    searchKeyword: '',
    showSearch: false,

    // === 列表数据 ===
    records: [] as CookRecord[],
    filteredRecords: [] as CookRecord[],
    loading: true,
    isEmpty: false,

    // === 分页数据 ===
    page: 1,
    pageSize: 5,
    hasMore: false,
    loadingMore: false,
    total: 0,

    // === 评论数据 ===
    commentMap: {} as Record<string, CommentItem[]>,

    // === 删除气泡 ===
    deleteBubbleId: '',
    deleteBubbleName: '',

    // === 统计数据 ===
    stats: {
      monthCount: 0,
      weekFrequency: 0,
      weekFrequencyText: '0',
      favoriteDish: '--',
    } as {
      monthCount: number
      weekFrequency: number
      weekFrequencyText: string
      favoriteDish: string
    },

    // === 新增记录弹窗 ===
    showAddModal: false,
    addForm: {
      recipeId: '',
      recipeName: '',
      image: '',           // 本地预览路径或base64数据
      base64ImageData: '',  // Base64 图片数据（用于直接存储到数据库）
      experience: '',
      cookedAt: '',
    } as {
      recipeId: string
      recipeName: string
      image: string
      base64ImageData: string
      experience: string
      cookedAt: string
    },
    uploading: false,

    // === 菜谱选择 ===
    showRecipePicker: false,
    recipeOptions: [] as RecipeOption[],
    recipeSearchKey: '',
  },

  // ==================== 生命周期 ====================

  onLoad() {
    this._setDefaultDate()
    this._loadData(1, false)
  },

  onShow() {
    //  intentionally left empty to avoid page reload after image preview
    // Users can pull down to refresh to update data
    // Data is reloaded after submitting new record in submitAddForm()
  },

  onPullDownRefresh() {
    this._loadData(1, false).then(() => wx.stopPullDownRefresh())
  },

  // ==================== 数据加载 ====================

  /**
   * 加载做菜历史数据
   * @param page    页码
   * @param append  是否追加模式（loadMore 时为 true，否则替换列表）
   */
  async _loadData(page: number, append: boolean): Promise<void> {
    const isFirstPage = page === 1

    this.setData({
      loading: isFirstPage && !append,
      loadingMore: !isFirstPage && append,
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getCookHistory',
        data: {
          page,
          pageSize: this.data.pageSize,
          keyword: this.data.searchKeyword.trim(),
        },
      })

      const result = res.result as any

      if (result?.success && Array.isArray(result.records)) {
        const newRecords = result.records.map((r: any) => ({
          ...r,
          dateStr: r.dateStr || this._formatDate(r.cookedAt || Date.now()),
          ingredientsExpanded: false,
          experienceExpanded: false,
          _commentInput: '',
          _commentSubmitting: false,
        }))

        // 追加模式：合并旧记录；替换模式：直接使用新记录
        const mergedRecords = append
          ? [...this.data.records, ...newRecords]
          : newRecords

        // 计算统计数据（仅首页需要）
        let stats = this.data.stats
        if (isFirstPage) {
          stats = this._calculateStats(mergedRecords, result.stats)
        }

        const hasMore = result.hasMore !== undefined ? result.hasMore : (result.records.length >= this.data.pageSize)
        const total = result.total || 0

        this.setData({
          records: mergedRecords,
          stats,
          page: result.page || page,
          hasMore,
          total,
          loading: false,
          loadingMore: false,
        }, () => {
          this._applyFilter()
        })

        // 异步加载评论（不阻塞页面渲染）
        if (newRecords.length > 0) {
          this._loadComments(append ? mergedRecords : newRecords)
        }
      } else {
        this.setData({
          records: append ? this.data.records : [],
          filteredRecords: append ? this.data.filteredRecords : [],
          isEmpty: !append && true,
          loading: false,
          loadingMore: false,
          hasMore: false,
        })
      }
    } catch (e) {
      console.error('加载做菜历史失败:', e)
      this.setData({
        records: append ? this.data.records : [],
        filteredRecords: append ? this.data.filteredRecords : [],
        isEmpty: !append && true,
        loading: false,
        loadingMore: false,
        hasMore: false,
      })
    }
  },

  /** 加载下一页 */
  loadMore(): void {
    if (this.data.loadingMore || !this.data.hasMore) return
    this._loadData(this.data.page + 1, true)
  },

  /** 批量加载所有记录的评论 */
  async _loadComments(records: CookRecord[]): Promise<void> {
    const recordIds = records.map(r => r._id).filter(Boolean)
    if (recordIds.length === 0) return

    try {
      const res = await wx.cloud.callFunction({
        name: 'getComments',
        data: { recordIds },
      })

      const result = res.result as any
      if (result?.success && result.commentMap) {
        // 预处理评论时间格式（WXML 中无法直接调用函数）
        const formattedMap: Record<string, CommentItem[]> = {}
        Object.keys(result.commentMap).forEach(key => {
          formattedMap[key] = result.commentMap[key].map((c: any) => ({
            ...c,
            timeText: this._formatCommentTime(c.createdAt),
          }))
        })
        this.setData({ commentMap: formattedMap })
      }
    } catch (e) {
      console.error('加载评论失败:', e)
    }
  },

  // ==================== 搜索与筛选 ====================

  onSearchInput(e: WechatMiniprogram.Input.InputEvent) {
    this.setData({ searchKeyword: e.detail.value })
  },

  onSearchConfirm() {
    // 搜索时重置到第 1 页，从服务端重新加载
    this._loadData(1, false)
  },

  toggleSearch() {
    const newShowSearch = !this.data.showSearch
    this.setData({
      showSearch: newShowSearch,
      searchKeyword: '',
    })
    if (!newShowSearch) {
      // 关闭搜索时重置到第 1 页
      this._loadData(1, false)
    }
  },

  _applyFilter(): void {
    const { records } = this.data

    // 数据已按时间倒序从服务端返回，直接使用
    const filtered = [...records]

    this.setData({
      filteredRecords: filtered,
      isEmpty: filtered.length === 0,
      loading: false,
    })
  },

  // ==================== 新增记录 ====================

  showAddForm() {
    this._setDefaultDate()
    this.setData({
      showAddModal: true,
      addForm: {
        recipeId: '',
        recipeName: '',
        image: '',
        base64ImageData: '',
        experience: '',
        cookedAt: this.data.addForm.cookedAt,
      },
    })
  },

  closeAddModal() {
    this.setData({ showAddModal: false })
  },

  // --- 图片上传（Base64 方案） ---
  async onChooseImage() {
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
      let finalPath = tempPath
      try {
        const compressRes = await wx.compressImage({
          src: tempPath,
          quality: 50,  // 降低到 50%，更激进压缩
          compressedWidth: 600,  // 进一步减小尺寸
          compressedHeight: 600,
        })
        finalPath = compressRes.tempFilePath
        console.log('[onChooseImage] 图片压缩成功:', tempPath, '->', finalPath)
      } catch (compressErr: any) {
        console.warn('[onChooseImage] 压缩失败，使用原图:', compressErr)
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
      console.log(`[onChooseImage] Base64 预估大小: ${estimatedSizeKB} KB`)
      if (estimatedSizeKB > 900) {  // 接近 1MB 限制时警告
        console.warn(`[onChooseImage] ⚠️ Base64 数据较大(${estimatedSizeKB}KB)，可能接近数据库限制`)
      }

      // 将 base64 数据保存到 data，提交时存入数据库
      this.setData({
        'addForm.image': tempPath,           // 本地路径用于预览（显示原图）
        'addForm.base64ImageData': base64Data,  // Base64 数据用于提交保存（使用压缩后的）
        uploading: false,
      })

      wx.hideLoading()
    } catch (e: any) {
      wx.hideLoading()
      if (e.errMsg && !String(e.errMsg).includes('cancel')) {
        console.error('封面图处理失败:', e)
        wx.showToast({ title: e.message || '图片处理失败', icon: 'none' })
      }
      this.setData({ uploading: false })
    }
  },

  removeImage() {
    this.setData({ 
      'addForm.image': '',
      'addForm.base64ImageData': ''  // 同时清空 base64 数据
    })
  },

  // --- 日期选择 ---
  onDateChange(e: WechatMiniprogram.Picker.PickerChangeEvent) {
    this.setData({ 'addForm.cookedAt': e.detail.value as string })
  },

  _setDefaultDate() {
    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    this.setData({ 'addForm.cookedAt': dateStr })
  },

  // --- 菜谱名称输入 ---
  onRecipeNameInput(e: WechatMiniprogram.Input.InputEvent) {
    this.setData({ 'addForm.recipeName': e.detail.value })
  },

  // --- 心得输入 ---
  onExperienceInput(e: WechatMiniprogram.Input.InputEvent) {
    this.setData({ 'addForm.experience': e.detail.value })
  },

  // --- 菜谱选择 ---
  showRecipePicker() {
    this.setData({ showRecipePicker: true, recipeSearchKey: '', recipeOptions: [] })
  },

  closeRecipePicker() {
    this.setData({ showRecipePicker: false })
  },

  async _loadRecipes(searchKey?: string) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRecipeRecommendations',
        data: {
          scenario: 'single',
          searchKey: searchKey || '',
          pageSize: 20,
        },
      })
      const result = res.result as any
      if (result?.success && Array.isArray(result.recipes)) {
        const recipeOptions = result.recipes.map((r: any) => ({
          _id: r._id || r.id,
          name: r.name,
          image: r.image || '',
        }))
        this.setData({ recipeOptions })
      }
    } catch (e) {
      console.error('加载菜谱失败:', e)
    }
  },

  onRecipeSearchInput(e: WechatMiniprogram.Input.InputEvent) {
    const key = e.detail.value
    this.setData({ recipeSearchKey: key })
    // 防抖搜索
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this._loadRecipes(key)
    }, 300) as any
  },

  _searchTimer: null as any,

  selectRecipe(e: WechatMiniprogram.TouchEvent) {
    const { id, name, image } = e.currentTarget.dataset
    const currentImage = this.data.addForm.image
    this.setData({
      'addForm.recipeId': id,
      'addForm.recipeName': name,
      // 优先保留用户已上传的自定义图片，只有在用户未上传图片时才使用菜谱图片
      'addForm.image': currentImage || image || '',
      showRecipePicker: false,
    })
  },

  // --- 提交表单 ---
  async submitAddForm() {
    const { recipeName, image, base64ImageData, experience, cookedAt } = this.data.addForm

    if (!recipeName.trim()) {
      wx.showToast({ title: '请输入菜谱名称', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    try {
      // 准备图片数据：优先使用 base64 数据，如果没有则使用 image（可能是菜谱图片URL）
      let imageData = ''
      if (base64ImageData && base64ImageData.trim()) {
        // Base64 方案：格式化为 data:image/jpeg;base64,xxxxx
        imageData = `data:image/jpeg;base64,${base64ImageData}`
        console.log(`[submitAddForm] 使用 Base64 图片数据，长度: ${imageData.length}`)
      } else if (image && !image.startsWith('wxfile://') && !image.startsWith('http://tmp/')) {
        // 如果用户没有上传图片，但选择了菜谱，使用菜谱的图片URL
        imageData = image
        console.log(`[submitAddForm] 使用菜谱图片URL: ${imageData}`)
      }

      const res = await wx.cloud.callFunction({
        name: 'recordCook',
        data: {
          recipeId: this.data.addForm.recipeId,
          recipeName: recipeName.trim(),
          image: imageData,  // 提交图片数据（Base64 或 URL）
          experience: (experience || '').trim(),  // 确保experience不为undefined
          cookedAt: cookedAt,
        },
      })

      const result = res.result as any

      if (result?.success) {
        wx.hideLoading()
        wx.showToast({ title: '记录成功', icon: 'success' })
        this.setData({ showAddModal: false })
        this._loadData(1, false)
      } else {
        wx.hideLoading()
        wx.showToast({ title: result?.errMsg || '保存失败', icon: 'none' })
      }
    } catch (e: any) {
      console.error('提交失败:', e)
      wx.hideLoading()
      wx.showToast({ title: '提交失败', icon: 'none' })
    }
  },

  // ==================== 评论功能 ====================

  /** 输入评论内容 */
  onCommentInput(e: WechatMiniprogram.Input.InputEvent) {
    const recordId = e.currentTarget.dataset.id as string
    const value = e.detail.value
    this._updateRecordField(recordId, '_commentInput', value)
  },

  /** 提交评论 */
  async submitComment(e: WechatMiniprogram.TouchEvent) {
    const recordId = e.currentTarget.dataset.id as string
    const record = this.data.records.find(r => r._id === recordId)
    const content = ((record as any)?._commentInput || '').trim()

    if (!content) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }

    if ((record as any)?._commentSubmitting) return

    this._updateRecordField(recordId, '_commentSubmitting', true)

    try {
      const res = await wx.cloud.callFunction({
        name: 'addComment',
        data: { recordId, content },
      })

      const result = res.result as any

      if (result?.success) {
        // 清空输入框 + 取消提交状态（克隆数组确保响应式）
        this._updateRecordField(recordId, '_commentInput', '')
        this._updateRecordField(recordId, '_commentSubmitting', false)

        // 重新加载评论
        this._loadComments(this.data.records)
      } else {
        wx.showToast({ title: result?.errMsg || '评论失败', icon: 'none' })
        this._updateRecordField(recordId, '_commentSubmitting', false)
      }
    } catch (e: any) {
      console.error('评论提交失败:', e)
      wx.showToast({ title: '评论失败', icon: 'none' })
      this._updateRecordField(recordId, '_commentSubmitting', false)
    }
  },

  /** 同步更新 records 和 filteredRecords 中某条记录的字段（克隆数组确保响应式） */
  _updateRecordField(recordId: string, field: string, value: any) {
    const updates: any = {}

    // 克隆 records 数组，只替换目标对象
    const recordIdx = this.data.records.findIndex(r => r._id === recordId)
    if (recordIdx >= 0) {
      const newRecords = [...this.data.records]
      newRecords[recordIdx] = { ...newRecords[recordIdx], [field]: value }
      updates.records = newRecords
    }

    // 克隆 filteredRecords 数组
    const filteredIdx = this.data.filteredRecords.findIndex(r => r._id === recordId)
    if (filteredIdx >= 0) {
      const newFiltered = [...this.data.filteredRecords]
      newFiltered[filteredIdx] = { ...newFiltered[filteredIdx], [field]: value }
      updates.filteredRecords = newFiltered
    }

    if (Object.keys(updates).length > 0) this.setData(updates)
  },

  /** 格式化评论时间 */
  _formatCommentTime(createdAt: any): string {
    const d = createdAt instanceof Date ? createdAt : new Date(createdAt)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHour = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    if (diffHour < 24) return `${diffHour}小时前`
    if (diffDay < 7) return `${diffDay}天前`

    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  },

  // ==================== 工具方法 ====================

  /** 计算统计数据 */
  _calculateStats(records: CookRecord[], apiStats: any): any {
    // 本月做菜次数（从云函数获取）
    const monthCount = apiStats?.monthCount || 0

    // 最常做的菜名（从云函数获取）
    const favoriteDish = apiStats?.favoriteDish || '--'

    // 计算平均每周做菜次数
    let weekFrequency = 0
    let weekFrequencyText = '0'
    if (records.length > 0) {
      // 获取第一次做菜的时间
      const firstCookTime = Math.min(...records.map(r => r.cookedAt))
      const now = Date.now()
      const weeksDiff = (now - firstCookTime) / (7 * 24 * 60 * 60 * 1000)
      if (weeksDiff > 0) {
        weekFrequency = (records.length / weeksDiff)  // 保留原始值
        // 格式化显示文本：整数不显示小数，小数保留1位
        weekFrequencyText = weekFrequency % 1 === 0 
          ? Math.floor(weekFrequency).toString() 
          : weekFrequency.toFixed(1)
      } else {
        weekFrequency = records.length  // 如果不到一周，就是总次数
        weekFrequencyText = records.length.toString()
      }
    }

    return {
      monthCount,
      weekFrequency,
      weekFrequencyText,
      favoriteDish,
    }
  },

  _formatDate(timestamp: number): string {
    const d = new Date(timestamp)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  },

  // ==================== 事件处理 ====================

  /** 点击记录 → 跳转菜谱详情 */
  goRecipeDetail(e: WechatMiniprogram.TouchEvent) {
    const recipeId = e.currentTarget.dataset.id as string
    if (recipeId) {
      wx.navigateTo({
        url: `/pages/recipe-detail/recipe-detail?id=${recipeId}`,
      })
    }
  },

  /** 预览图片 */
  previewImage(e: WechatMiniprogram.TouchEvent) {
    // catchtap 已自动阻止事件冒泡，无需手动调用 stopPropagation
    const url = e.currentTarget.dataset.url as string
    if (url) {
      wx.previewImage({
        current: url,
        urls: [url],
      })
    }
  },

  /** 空状态按钮：去发现菜谱 */
  goDiscoverRecipes(): void {
    wx.switchTab({ url: '/pages/recipes/recipes' })
  },

  /** 阻止事件冒泡 */
  preventBubble() {
    // catchtouchstart/catchtouchmove/catchtouchend 已自动阻止事件冒泡，此函数仅作为事件处理函数存在
  },

  // ==================== 展开/收起功能 ====================

  /** 切换食材详情展开状态 */
  toggleIngredients(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const records = this.data.records.map(r => {
      if (r._id === id) {
        return { ...r, ingredientsExpanded: !r.ingredientsExpanded }
      }
      return r
    })
    const filteredRecords = this.data.filteredRecords.map(r => {
      if (r._id === id) {
        return { ...r, ingredientsExpanded: !r.ingredientsExpanded }
      }
      return r
    })
    this.setData({ records, filteredRecords })
  },

  /** 切换心得展开状态 */
  toggleExperience(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const records = this.data.records.map(r => {
      if (r._id === id) {
        return { ...r, experienceExpanded: !r.experienceExpanded }
      }
      return r
    })
    const filteredRecords = this.data.filteredRecords.map(r => {
      if (r._id === id) {
        return { ...r, experienceExpanded: !r.experienceExpanded }
      }
      return r
    })
    this.setData({ records, filteredRecords })
  },

  // ==================== 删除功能 ====================

  /** 长按记录卡片 → 弹出删除气泡 */
  onLongPressRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return

    // 从当前列表中找到对应的记录名
    const record = this.data.filteredRecords.find(r => r._id === id)
    const name = record?.name || '这条记录'

    this.setData({ deleteBubbleId: id, deleteBubbleName: name })
  },

  /** 隐藏删除气泡 */
  hideDeleteBubble() {
    if (this.data.deleteBubbleId) {
      this.setData({ deleteBubbleId: '', deleteBubbleName: '' })
    }
  },

  /** 点击删除气泡中的删除按钮 → 弹出二次确认对话框 */
  onTapDeleteBubble() {
    const id = this.data.deleteBubbleId
    if (!id) return

    // 先隐藏气泡
    this.setData({ deleteBubbleId: '', deleteBubbleName: '' })

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条做菜记录吗？删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#FF6B6B',
      success: (res) => {
        if (res.confirm) {
          this._deleteRecord(id)
        }
      },
    })
  },

  /** 执行删除 */
  async _deleteRecord(id: string): Promise<void> {
    wx.showLoading({ title: '删除中...' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'recordCook',
        data: {
          action: 'delete',
          _id: id,
        },
      })

      const result = res.result as any

      if (result?.success) {
        wx.hideLoading()
        wx.showToast({ title: '已删除', icon: 'success' })
        // 重新加载数据（回到第1页）
        this._loadData(1, false)
      } else {
        wx.hideLoading()
        wx.showToast({ title: result?.errMsg || '删除失败', icon: 'none' })
      }
    } catch (e: any) {
      wx.hideLoading()
      console.error('删除失败:', e)
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  },
})
