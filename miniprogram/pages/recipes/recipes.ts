// pages/recipes/recipes.ts
/**
 * 菜谱发现页 - 纯云数据库数据源
 */
import { SCENARIOS } from '../../utils/constants'

interface RecipeItem {
  _id: string
  name: string
  image: string
  description: string
  cookTime: number
  difficulty: string
  tags: string[]
  matchRate: number
  canCook: boolean
  servings: Record<string, number>
  missingIngredients: any[]
  source?: string
}

Page({
  data: {
    scenario: 'single',
    searchKey: '',
    currentFilter: 'all',
    filters: [
      { label: '全部', value: 'all' },
      { label: '✅ 可做', value: 'canCook' },
      { label: '⚡ 快手菜', value: 'quick' },
      { label: '🔥 下饭菜', value: 'hearty' },
      { label: '🥗 轻食', value: 'light' },
    ] as any[],

    recipes: [] as RecipeItem[],
    foodCount: 0,
    canCookCount: 0,
    loading: false,
    loadingMore: false,
    hasMore: true,
    page: 1,
    pageSize: 10,

    // 删除气泡状态
    bubbleVisible: false,
    bubbleTargetId: '',
    bubbleTargetName: '',
    bubbleTargetIndex: -1,
    deleting: false,
  },

  // 标记从详情页带入的搜索关键词
  _pendingIngredient: '' as string,

  onLoad() {
    // 注意：菜谱页是 tabBar 页面，switchTab 跳转不会传递 query 参数，
    // 所有跳转逻辑通过 onShow + 全局缓存 app._pendingIngredient 处理
    const app = getApp<any>()

    // ★ 如果全局缓存已有 pending 关键词（从食材详情页跳转来），
    // 不调用 loadRecipes，等 onShow 统一触发带关键词的搜索，
    // 避免与 onShow 中 force=true 的调用形成并发竞态
    if (app._pendingIngredient) {
      this._pendingIngredient = app._pendingIngredient
    } else {
      this.setData({ scenario: app.globalData.scenario })
      this.loadRecipes()
    }
  },

  onShow() {
    const app = getApp<any>()

    // ★ 从食材详情页跳转过来时，app._pendingIngredient 已在 switchTab 前写入
    if (app._pendingIngredient && app._pendingIngredient !== this.data.searchKey) {
      const keyword = app._pendingIngredient
      this._pendingIngredient = keyword
      app._pendingIngredient = ''  // 消费后清空，避免重复触发
      // ★ 强制重新搜索：force=true 忽略 loading 守卫，确保关键词被使用
      this.setData({ searchKey: keyword })
      this.loadRecipes(false, keyword, true)
      return
    }

    const scenario = app.globalData.scenario
    if (scenario !== this.data.scenario) {
      this.setData({ scenario }, () => this.loadRecipes())
    } else {
      this.loadRecipes()
    }
  },

  onHide() {
    this._clearBubbleTimer()
    this.onHideBubble()
  },

  onPullDownRefresh() {
    this.loadRecipes().then(() => wx.stopPullDownRefresh())
  },

  /** 加载菜谱（纯云数据库数据源）
   * @param append 是否追加模式（翻页）
   * @param searchKeyOverride 搜索关键词覆盖（用于 setData 异步未生效时直接传入）
   * @param force 强制重新加载（忽略 loading 守卫，用于 onShow 中抢在并发加载前应用搜索词）
   */
  async loadRecipes(append = false, searchKeyOverride?: string, force = false) {
    if (this.data.loading && !append && !force) return

    const effectiveSearchKey = searchKeyOverride ?? this.data.searchKey.trim()

    this.setData({
      loading: !append,
      loadingMore: append,
      searchKey: searchKeyOverride ?? this.data.searchKey,
      page: append ? this.data.page + 1 : 1,
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getRecipeRecommendations',
        data: {
          scenario: this.data.scenario,
          searchKey: effectiveSearchKey,
          // filter: this.data.currentFilter === 'all' ? undefined : this.data.currentFilter,
          page: append ? this.data.page + 1 : 1,
          pageSize: this.data.pageSize,
        },
      })

      let newRecipes: RecipeItem[] = []
      console.log(res?.result)
      if (res?.result?.recipes && Array.isArray(res.result.recipes)) {
        newRecipes = res.result.recipes.map((r: any) => ({
          ...r,
          // ★ 确保每道菜都有图片（云函数已过滤，这里做二次保险）
        }))

        // 二次过滤：确保没有空图片的菜谱漏网
        newRecipes = newRecipes.filter((r: RecipeItem) => r.image && r.image.trim())

        this.setData({
          recipes: append ? [...this.data.recipes, ...newRecipes] : newRecipes,
          hasMore: newRecipes.length >= this.data.pageSize,
          foodCount: res.result.foodCount || 0,
          canCookCount: (append ? this.data.canCookCount : 0) + (newRecipes.filter((r: any) => r.canCook).length),
          // currentSource: res.result.source || 'database',
        })
      } else {
        // 无数据 → 显示空状态（不使用任何兜底）
        this.setData({
          recipes: append ? this.data.recipes : [],
          hasMore: false,
          foodCount: 0,
          canCookCount: 0,
        })
      }
    } catch (e) {
      console.error('加载菜谱失败:', e)
      this.setData({ recipes: [], hasMore: false })
    } finally {
      this.setData({ loading: false, loadingMore: false })
    }
  },

  /** 加载更多 */
  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return
    this.loadRecipes(true)
  },

  /* === 事件处理 === */

  onScenarioChange(e: WechatMiniprogram.CustomEvent) {
    const value = e.detail.value
    const app = getApp<IAppOption>()
    app.setScenario(value)
    this.setData({ scenario: value }, () => this.loadRecipes())
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    clearTimeout(this.searchTimer as any)
    this.setData({ searchKey: e.detail.value })
    this.searchTimer = setTimeout(() => this.loadRecipes(), 400) as any
  },

  onFilterChange(e: WechatMiniprogram.TouchEvent) {
    this.setData({ currentFilter: e.currentTarget.dataset.value }, () => this.loadRecipes())
  },

  goDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/recipe-detail/recipe-detail?id=${id}` })
    }
  },

  goAddFood() {
    wx.navigateTo({ url: '/pages/add-food/add-food' })
  },

  goAddRecipe() {
    wx.navigateTo({ url: '/pages/add-recipe/add-recipe' })
  },

  /* === 长按删除 === */

  /** 长按菜谱卡片 — 弹出删除气泡 */
  onRecipeLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const index = e.currentTarget.dataset.index as number
    const name = this.data.recipes[index]?.name || ''

    if (!id) return

    this._clearBubbleTimer()
    this.setData({
      bubbleVisible: true,
      bubbleTargetId: id,
      bubbleTargetName: name,
      bubbleTargetIndex: index,
    })

    // 3秒后自动隐藏气泡
    this._bubbleTimer = setTimeout(() => {
      this.onHideBubble()
    }, 3000) as any
  },

  /** 隐藏删除气泡 */
  onHideBubble() {
    this._clearBubbleTimer()
    if (this.data.bubbleVisible) {
      this.setData({
        bubbleVisible: false,
        bubbleTargetId: '',
        bubbleTargetName: '',
        bubbleTargetIndex: -1,
      })
    }
  },

  /** 点击气泡中的"删除" — 弹出二次确认 */
  onTapDeleteBubble() {
    const { bubbleTargetName, bubbleTargetId } = this.data
    this.onHideBubble()

    wx.showModal({
      title: '确认删除',
      content: `确定要删除「${bubbleTargetName}」这道菜谱吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#FF4444',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.performDelete(bubbleTargetId)
        }
      },
    })
  },

  /** 执行删除操作 */
  async performDelete(recipeId: string) {
    if (this.data.deleting) return

    this.setData({ deleting: true })
    wx.showLoading({ title: '删除中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'deleteRecipe',
        data: { recipeId },
      })

      wx.hideLoading()

      const result = res.result as { success: boolean; message?: string; error?: string }

      if (result?.success) {
        // 从列表中移除已删除的菜谱
        const newRecipes = this.data.recipes.filter((r) => r._id !== recipeId)
        this.setData({ recipes: newRecipes })
        wx.showToast({ title: '已删除', icon: 'success' })
      } else {
        wx.showToast({ title: result?.error || '删除失败', icon: 'none' })
      }
    } catch (err: any) {
      wx.hideLoading()
      console.error('删除菜谱失败:', err)
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    } finally {
      this.setData({ deleting: false })
    }
  },

  /** 清除气泡定时器 */
  _clearBubbleTimer() {
    if (this._bubbleTimer) {
      clearTimeout(this._bubbleTimer)
      this._bubbleTimer = null
    }
  },
})
