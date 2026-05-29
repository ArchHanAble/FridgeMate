// pages/profile/profile.ts
import { SCENARIOS, SCENARIO_LABELS } from '../../utils/constants'
import { createInviteCode, acceptInvite as apiAcceptInvite } from '../../utils/api'

const EXPIRY_TEMPLATE_ID = wx.getStorageSync('expiry_template_id') || '528n6ipGAklINTuBpISGgaOFqio_KcHDMJ-oRxf7s98'

// === 饮食偏好选项 ===
const TASTE_OPTIONS = ['咸', '甜', '辣', '清淡', '酸', '鲜', '麻']
// 用口味名映射颜色（咸→蓝, 甜→橙, 辣→红, 清淡→绿, 酸→紫, 鲜→黄, 麻→棕）
const TASTE_COLOR_MAP: Record<string, string> = {
  '咸': '#74C0FC',
  '甜': '#FF922B',
  '辣': '#FF6B6B',
  '清淡': '#51CF66',
  '酸': '#E599F7',
  '鲜': '#FFE066',
  '麻': '#C9956B',
}

const ALLERGY_OPTIONS = ['花生', '海鲜', '乳制品', '麸质/小麦', '鸡蛋', '坚果']

const DIET_TYPE_OPTIONS = [
  { label: '无特殊', value: 'normal', desc: '什么都吃' },
  { label: '素食', value: 'vegetarian', desc: '不含肉类' },
  { label: '低卡', value: 'lowcalorie', desc: '≤ 400 kcal / 份' },
  { label: '健身餐', value: 'fitness', desc: '高蛋白低脂' },
  { label: '控糖', value: 'lowsugar', desc: '低 GI 食材' },
  { label: '孕期饮食', value: 'pregnancy', desc: '营养均衡优先' },
]

Page({
  data: {
    // === 用户信息（从 app.globalData 同步） ===
    userInfo: {
      nickName: '',
      avatarUrl: '',
    } as { nickName: string; avatarUrl: string },
    userId: '',          // openid 截取显示
    isLoggedIn: false,   // 是否已登录（有 openid）
    isNewUser: false,    // 是否是新用户（引导设置昵称）

    // 编辑昵称相关
    showNicknameInput: false,
    tempNickname: '',
    isEditingProfile: false,

    // 场景模式
    scenario: 'single',
    scenarioHints: {
      [SCENARIOS.SINGLE]: '🍱 适合独居生活，推荐快手小份菜，减少浪费',
      [SCENARIOS.COUPLE]: '💕 适合情侣日常，推荐有仪式感的双人餐',
      [SCENARIOS.FAMILY]: '👨‍👩‍👧‍👦 适合家庭用餐，推荐营养均衡的大份菜谱',
    },

    // 提醒设置
    notifyEnabled: false,
    notifySubscribed: false,
    notifyBeforeDays: 3,
    notifyDaysOptions: ['1天', '2天', '3天', '5天', '7天'],
    notifyDaysIndex: 2,

    // 到期检查预览
    expiryCheckResult: null as any,
    checkingExpiry: false,

    // 共享
    sharedMembers: [] as any[],
    isOwner: false,

    // 邀请弹窗
    showInviteModal: false,
    currentInviteCode: '',       // 从云函数获取的真实邀请码
    inviteCodeCopied: false,      // 是否已复制
    showJoinInput: false,
    joinInviteCode: '',
    
    // 权限提示
    showPermissionTip: false,

    // 统计
    stats: {
      totalFoods: 0,
      cookedRecipes: 0,
      favoriteCount: 0,
      wastePrevented: 0,
      moneySaved: 0,
      co2Saved: 0,
    },

    // 饮食偏好
    tasteOptions: TASTE_OPTIONS,
    tasteColors: TASTE_COLOR_MAP,
    // 派生字段：口味标签的预计算样式（WXML 不支持三元+拼接，必须在 TS 层算好）
    tasteTagStyles: [] as string[],
    allergyOptions: ALLERGY_OPTIONS,
    dietTypeOptions: DIET_TYPE_OPTIONS,
    dietPrefs: {
      tastes: [] as string[],
      allergies: [] as string[],
      dietType: 'normal',
    },
    hasUnsavedDietChanges: false,

    // 饮食偏好编辑模式（默认只读展示）
    isEditingDiet: false,
  },

  onShow() {
    this._syncFromGlobal()
    this._loadAll()
  },

  /** 从全局状态同步登录信息 */
  _syncFromGlobal() {
    const app = getApp<IAppOption>()
    
    this.setData({
      isLoggedIn: !!app.globalData.openid,
      userId: this._formatOpenid(app.globalData.openid || ''),
    })

    if (app.globalData.userInfo) {
      const info = app.globalData.userInfo
      this.setData({
        'userInfo.nickName': info.nickName || '',
        'userInfo.avatarUrl': info.avatarUrl || '',
        isNewUser: !info.nickName,   // 没昵称 = 新用户，引导编辑
      })
    }

    // 同步场景
    if (app.globalData.scenario) {
      this.setData({ scenario: app.globalData.scenario })
    }
  },

  /**
   * 跳转登录页面（未登录时点击头像触发）
   */
  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: (err) => {
        console.error('❌ 跳转登录页失败:', err)
        wx.showToast({ title: '登录页暂不可用', icon: 'none' })
      },
    })
  },

  /** 将 openid 格式化为可读的短 ID */
  _formatOpenid(openid: string): string {
    if (!openid) return ''
    // 取前8位...后4位，中间省略
    if (openid.length <= 14) return openid
    return `${openid.substring(0, 8)}...${openid.substring(openid.length - 4)}`
  },

  async _loadAll() {
    const app = getApp<IAppOption>()

    // 场景设置
    this.setData({ 
      scenario: app.globalData.scenario || 'single',
    })

    // 如果还没登录成功，等待一下再试
    if (!app.globalData.openid) {
      await new Promise(resolve => setTimeout(resolve, 500))
      this._syncFromGlobal()
    }

    // 从存储加载提醒设置
    const settings = wx.getStorageSync('user_settings') || {}
    if (settings.notifyEnabled !== undefined) this.setData({ notifyEnabled: settings.notifyEnabled })
    if (settings.notifyBeforeDays) {
      this.setData({
        notifyBeforeDays: settings.notifyBeforeDays,
        notifyDaysIndex: this.data.notifyDaysOptions.indexOf(`${settings.notifyBeforeDays}天`),
      })
    }

    // 加载饮食偏好
    this._loadDietPrefs(settings)

    // 并行加载统计 + 共享成员
    this._loadStats()
    this._loadSharedMembers()
  },

  /* ====== 头像/昵称编辑（微信新版能力） ====== */

  /**
   * 点击头像区域（备用入口）
   * 主要通过 button open-type="chooseAvatar" 处理
   */
  onTapAvatarArea() {
    // 实际头像选择由 <button open-type="chooseAvatar"> 处理
    // 此方法仅作为兜底
  },

  /**
   * 选择头像回调
   * 使用 <button open-type="chooseAvatar"> 触发
   */
  async onChooseAvatar(e: any) {
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return

    console.log('📷 用户选择了新头像')

    this.setData({
      'userInfo.avatarUrl': avatarUrl,
      isEditingProfile: true,
    })

    // 立即上传到云端
    this._saveProfileToCloud()
  },

  /**
   * 昵称输入框输入
   * 使用 <input type="nickname"> 触发微信昵称键盘
   */
  onNicknameInput(e: any) {
    const nickName = e.detail.value?.trim()
    if (nickName) {
      this.setData({
        tempNickname: nickName,
        'userInfo.nickName': nickName,
        isEditingProfile: true,
      })
    }
  },

  /**
   * 点击昵称区域 —— 切换到编辑模式
   */
  onTapNickname() {
    if (this.data.isEditingProfile) return
    this.setData({
      showNicknameInput: true,
      tempNickname: this.data.userInfo.nickName,
    })
  },

  /**
   * 手动输入昵称（兼容旧版）
   */
  onManualNicknameInput(e: any) {
    this.setData({ tempNickname: e.detail.value })
  },

  /** 确认昵称修改 */
  confirmNickname() {
    const nickName = this.data.tempNickname.trim()
    if (!nickName) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }

    this.setData({
      'userInfo.nickName': nickName,
      showNicknameInput: false,
      isEditingProfile: true,
    })

    this._saveProfileToCloud()
    wx.showToast({ title: '✅ 昵称已更新', icon: 'success' })
  },

  /** 取消昵称编辑 */
  cancelNicknameEdit() {
    this.setData({ showNicknameInput: false, tempNickname: '' })
  },

  /**
   * 将用户资料保存到云端
   */
  async _saveProfileToCloud() {
    const app = getApp<IAppOption>()
    if (!app.globalData.openid) {
      console.warn('⚠️ 未登录，无法保存资料')
      return
    }

    try {
      const res = await app.updateUserInfo(
        this.data.userInfo.nickName,
        this.data.userInfo.avatarUrl,
      )

      if (res.success) {
        this.setData({ isEditingProfile: false, isNewUser: false })
        console.log('✅ 用户资料已保存到云端')
      }
    } catch (e) {
      console.error('❌ 保存资料失败:', e)
    }
  },

  /* ====== 原有功能保持不变 ====== */

  _loadStats() {
    const favorites = (wx.getStorageSync('favorite_recipes') || []).length
    
    let totalFoods = 0
    try {
      const db = wx.cloud.database()
      db.collection('fridge_items').count().then((res: any) => {
        totalFoods = res.total || 0
        // 模拟统计数据（实际可从数据库聚合查询）
        const wastePrevented = Math.floor(totalFoods * 0.3)
        const moneySaved = wastePrevented * 15 // 假设每次减少浪费平均省15元
        const co2Saved = wastePrevented * 2

        this.setData({
          'stats.totalFoods': totalFoods,
          'stats.favoriteCount': favorites,
          'stats.cookedRecipes': favorites, // 暂用收藏数代替，后续可接入做菜记录
          'stats.wastePrevented': wastePrevented,
          'stats.moneySaved': moneySaved,
          'stats.co2Saved': co2Saved,
        })
      }).catch(() => {})
    } catch (e) {}
    
    this.setData({ 'stats.favoriteCount': favorites })
  },

  async _loadSharedMembers() {
    try {
      const db = wx.cloud.database()
      const app = getApp<IAppOption>()
      const myOpenid = app.globalData.openid
      if(myOpenid === 'oqVI53QNQBP8vAjPEXcWkebp-83A'){
        this.setData({
          isOwner:  true,
        })
      }
      const res = await db.collection('shared_fridges').where({}).get()
      if (res.data && res.data.length > 0) {
        const fridge = res.data[0]
        const members = (fridge.members || []).map((m: any, i: number) => ({
          ...m,
          displayName: m.name || '成员' + (i + 1),
        }))
        this.setData({
          sharedMembers: members,
          // isOwner: myOpenid ? fridge.ownerOpenId === myOpenid : true,
        })
      }
    } catch (e) {}
  },

  /* === 场景切换 === */
  onScenarioChange(e: WechatMiniprogram.CustomEvent) {
    const value = e.detail.value
    const app = getApp<IAppOption>()
    app.setScenario(value)
    this.setData({ scenario: value })

    const settings = wx.getStorageSync('user_settings') || {}
    settings.scenario = value
    wx.setStorageSync('user_settings', settings)

    wx.showToast({ title: `已切换为${SCENARIO_LABELS[value]}`, icon: 'none' })
  },

  /* === 提醒开关 === */
  async onNotifyToggle(e: WechatMiniprogram.SwitchChange) {
    const enabled = e.detail.value

    if (!enabled) {
      this.setData({ notifyEnabled: false })
      this._saveNotifySettings({ notifyEnabled: false })
      return
    }

    if (!EXPIRY_TEMPLATE_ID) {
      wx.showModal({
        title: '⚠️ 模板未配置',
        content: '订阅消息模板ID尚未配置。\n\n请前往小程序管理后台申请「到期提醒」模板，并将templateId填入设置。',
        confirmText: '我知道了',
        showCancel: false,
      })
      return
    }

    wx.showLoading({ title: '请求订阅权限...' })

    try {
      const subRes: any = await new Promise((resolve) => {
        wx.requestSubscribeMessage({
          tmplIds: [EXPIRY_TEMPLATE_ID],
          success: resolve,
          fail: resolve,
        })
      })

      wx.hideLoading()

      const accepted = subRes[EXPIRY_TEMPLATE_ID] === 'accept'

      if (accepted) {
        this.setData({ 
          notifyEnabled: true, 
          notifySubscribed: true,
        })
        this._saveNotifySettings({ notifyEnabled: true, notifySubscribed: true })
        wx.showToast({ title: '✅ 已开启到期提醒', icon: 'success' })
        this.checkExpiryStatus()
      } else {
        this.setData({ notifyEnabled: false })
        wx.showModal({
          title: '未授权订阅',
          content: '你需要授权订阅消息才能收到到期提醒。\n\n可以在微信 → 设置 → 订阅消息中重新开启。',
          confirmText: '知道了',
          showCancel: false,
        })
      }
    } catch (e: any) {
      wx.hideLoading()
      console.error('订阅失败:', e)
      wx.showToast({ title: '订阅请求失败', icon: 'none' })
    }
  },

  _saveNotifySettings(updates: Record<string, any>) {
    const settings = wx.getStorageSync('user_settings') || {}
    Object.assign(settings, updates)
    wx.setStorageSync('user_settings', settings)

    wx.cloud.callFunction({
      name: 'sendExpiryNotify',
      data: { action: 'requestSubscribe' },
    }).catch(() => {})
  },

  async checkExpiryStatus() {
    if (this.data.checkingExpiry) return
    this.setData({ checkingExpiry: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'sendExpiryNotify',
        data: {
          action: 'check',
          daysBefore: this.data.notifyBeforeDays,
        },
      })

      if (res.result?.success) {
        this.setData({ expiryCheckResult: res.result })
      }
    } catch (e) {
      console.error('到期检查失败:', e)
    } finally {
      this.setData({ checkingExpiry: false })
    }
  },

  onNotifyDaysChange(e: WechatMiniprogram.PickerChange) {
    const days = parseInt(this.data.notifyDaysOptions[e.detail.value])
    this.setData({
      notifyBeforeDays: days,
      notifyDaysIndex: Number(e.detail.value),
    })

    const settings = wx.getStorageSync('user_settings') || {}
    settings.notifyBeforeDays = days
    wx.setStorageSync('user_settings', settings)
  },

  /* === 共享操作（真实调用云函数） === */

  /** 打开邀请弹窗 — 先调用云函数生成邀请码 */
  async inviteShare() {
    // 先显示权限提示
    this.setData({ showPermissionTip: true })

    wx.showLoading({ title: '生成邀请码...' })
    try {
      const res: any = await createInviteCode()
      wx.hideLoading()

      if (res.result?.success) {
        const code = res.result.inviteCode || ''
        this.setData({
          showInviteModal: true,
          currentInviteCode: code,
          inviteCodeCopied: false,
        })
        // 重新加载成员列表
        this._loadSharedMembers()
      } else {
        wx.showToast({ title: res.errMsg || '生成邀请码失败', icon: 'none' })
      }
    } catch (e: any) {
      wx.hideLoading()
      console.error('❌ 生成邀请码失败:', e)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
  },

  /** 关闭邀请弹窗 */
  closeInviteModal() {
    this.setData({ 
      showInviteModal: false, 
      showPermissionTip: false,
      inviteCodeCopied: false,
    })
  },

  /** 复制邀请码到剪贴板 */
  copyInviteCode() {
    const code = this.data.currentInviteCode
    if (!code) return

    wx.setClipboardData({
      data: code,
      success: () => {
        this.setData({ inviteCodeCopied: true })
        wx.showToast({ title: '已复制邀请码 ✅', icon: 'none' })
      },
    })
  },

  /** 分享给微信好友 */
  shareToWechat() {
    const code = this.data.currentInviteCode
    if (!code) return

    // 使用小程序的 onShareAppMessage 能力，或通过 button open-type="share" 触发
    // 这里先复制到剪贴板作为兜底
    wx.setClipboardData({
      data: `🧊 冰箱管家 · 邀请码：${code}\n\n扫码或输入邀请码即可加入我的冰箱共享！`,
      success: () => {
        wx.showToast({ title: '分享内容已复制，去粘贴发送吧~', icon: 'none', duration: 2500 })
      },
    })
  },

  /** 显示加入冰箱输入框 */
  showJoinInput() {
    this.setData({ showJoinInput: true, joinInviteCode: '' })
  },

  /** 取消加入 */
  cancelJoin() {
    this.setData({ showJoinInput: false, joinInviteCode: '' })
  },

  /** 确认接受邀请 — 调用云函数 */
  async confirmAcceptInvite() {
    const code = this.data.joinInviteCode.trim()
    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' })
      return
    }

    wx.showLoading({ title: '正在加入...' })
    try {
      const res: any = await apiAcceptInvite(code)
      wx.hideLoading()

      if (res.result?.success) {
        wx.showToast({ 
          title: res.result.message || '✅ 已成功加入！', 
          icon: 'success',
          duration: 2000,
        })
        this.setData({ showJoinInput: false, joinInviteCode: '' })
        // 重新加载成员列表
        setTimeout(() => this._loadSharedMembers(), 500)
      } else {
        wx.showModal({
          title: '加入失败',
          content: res.errMsg || res.result?.errMsg || '无法加入该冰箱',
          showCancel: false,
          confirmText: '我知道了',
        })
      }
    } catch (e: any) {
      wx.hideLoading()
      console.error('❌ 接受邀请失败:', e)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
  },

  /** 输入邀请码 */
  onJoinCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ joinInviteCode: e.detail.value.toUpperCase() })
  },

  /** 移除成员 — 管理员操作 */
  removeMember(e: WechatMiniprogram.TouchEvent) {
    const memberOpenId = e.currentTarget.dataset.id
    if (!memberOpenId) return

    // 找到成员名用于提示
    const member = this.data.sharedMembers.find((m: any) => m.openId === memberOpenId)
    const name = member?.displayName || '该成员'

    wx.showModal({
      title: '移除成员',
      content: `确定要移除「${name}」吗？\n\n他们将无法再查看和编辑你的冰箱数据。`,
      confirmColor: '#FF6B6B',
      confirmText: '确认移除',
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '处理中...' })
        try {
          const db = wx.cloud.database()
          const app = getApp<IAppOption>()
          
          // 查找当前用户的共享组
          const fridgeRes = await db.collection('shared_fridges')
            .where({ ownerOpenId: app.globalData.openid })
            .limit(1)
            .get()
          
          if (fridgeRes.data && fridgeRes.data.length > 0) {
            const group = fridgeRes.data[0]
            const updatedMembers = (group.members || []).filter((m: any) => m.openId !== memberOpenId)
            
            await db.collection('shared_fridges').doc(group._id).update({
              data: { members: updatedMembers, updatedAt: new Date() }
            })

            wx.showToast({ title: '已移除', icon: 'success' })
            // 刷新成员列表
            this._loadSharedMembers()
          } else {
            wx.showToast({ title: '未找到共享组', icon: 'none' })
          }
        } catch (e: any) {
          console.error('❌ 移除成员失败:', e)
          wx.showToast({ title: '操作失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  /* === 导航 === */

  /* ====== 饮食偏好设置 ====== */

  /** 从存储加载饮食偏好 */
  _loadDietPrefs(settings: any = {}) {
    const dietPrefs = settings.dietPrefs || wx.getStorageSync('diet_prefs') || {}
    this.setData({
      dietPrefs: {
        tastes: dietPrefs.tastes || [],
        allergies: dietPrefs.allergies || [],
        dietType: dietPrefs.dietType || 'normal',
      },
    })
    this._computeTasteTagStyles()
  },

  /**
   * 预计算口味标签的行内样式
   * WXML 不支持三元运算符+字符串拼接，必须在 TS 层算好
   */
  _computeTasteTagStyles() {
    const { tasteOptions, dietPrefs, tasteColors } = this.data as any
    const styles: string[] = []
    for (const item of tasteOptions) {
      if (dietPrefs.tastes.indexOf(item) >= 0 && tasteColors[item]) {
        styles.push('--tag-color:' + tasteColors[item])
      } else {
        styles.push('')
      }
    }
    this.setData({ tasteTagStyles: styles })
  },

  /** 切换口味标签（多选） */
  toggleTaste(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value
    if (!value) return
    const tastes = [...this.data.dietPrefs.tastes]
    const idx = tastes.indexOf(value)
    if (idx >= 0) {
      tastes.splice(idx, 1)
    } else {
      tastes.push(value)
    }
    this.setData({ 'dietPrefs.tastes': tastes, hasUnsavedDietChanges: true })
    this._computeTasteTagStyles()
  },

  /** 切换忌口/过敏原（多选） */
  toggleAllergy(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value
    if (!value) return
    const allergies = [...this.data.dietPrefs.allergies]
    const idx = allergies.indexOf(value)
    if (idx >= 0) {
      allergies.splice(idx, 1)
    } else {
      allergies.push(value)
    }
    this.setData({ 'dietPrefs.allergies': allergies, hasUnsavedDietChanges: true })
  },

  /** 选择饮食类型（单选） */
  selectDietType(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value
    if (!value) return
    this.setData({ 'dietPrefs.dietType': value, hasUnsavedDietChanges: true })
  },

  /** 进入编辑模式 */
  enterEditDiet() {
    this.setData({ isEditingDiet: true, hasUnsavedDietChanges: false })
  },

  /** 保存饮食偏好到本地存储 + 同步全局 + 退出编辑模式 */
  saveDietPrefs() {
    const { dietPrefs } = this.data

    // 写入本地存储
    wx.setStorageSync('diet_prefs', dietPrefs)

    // 同步到 user_settings（方便云函数读取）
    const settings = wx.getStorageSync('user_settings') || {}
    settings.dietPrefs = dietPrefs
    wx.setStorageSync('user_settings', settings)

    // 同步到 app.globalData（供菜谱推荐使用）
    const app = getApp<IAppOption>()
    if (app.globalData) {
      app.globalData.dietPrefs = dietPrefs
    }

    this.setData({ hasUnsavedDietChanges: false, isEditingDiet: false })
    wx.showToast({ title: '✅ 偏好已保存', icon: 'success' })
    console.log('🥗 饮食偏好已保存:', dietPrefs)
  },

  /* ====== 统计升级 ====== */
  goHistory() {
    wx.navigateTo({ url: '/pages/cook-history/cook-history' })
  },

  goFeedback() {
    wx.showModal({
      title: '意见反馈',
      content: '有任何问题或建议，欢迎通过小程序客服联系我们～',
      showCancel: false,
      confirmText: '好的',
    })
  },

  showAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },

  /** 切换账号 */
  switchAccount() {
    wx.showModal({
      title: '切换账号',
      content: '切换后将退出当前账号，需要重新登录',
      confirmColor: '#FF6A88',
      success: (res) => {
        if (res.confirm) {
          const app = getApp<IAppOption>()
          app.switchAccount()
        }
      },
    })
  },

  /** 退出登录 */
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？\n本地数据将被清除，但云端数据保留。',
      confirmText: '确认退出',
      confirmColor: '#FF4D4F',
      success: (res) => {
        if (res.confirm) {
          const app = getApp<IAppOption>()
          app.logout()

          // 重置页面状态
          this.setData({
            isLoggedIn: false,
            userInfo: { nickName: '', avatarUrl: '' },
            userId: '',
          })

          wx.showToast({ title: '已退出登录', icon: 'none' })
        }
      },
    })
  },
})
