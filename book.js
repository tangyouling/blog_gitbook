let plugins = [
  '-lunr', // 默认插件，无需引用
  '-sharing', // 默认插件，无需引用
  '-search', // 默认插件，无需引用
  '-favicon', // 默认插件，无需引用
  'code',
  'expandable-chapters',
  'theme-lou',
  'back-to-top-button',
  'search-pro',
  'flexible-alerts',
  'intopic-toc', //添加文章章节预览
  'github', //添加github图标

];
if (process.env.NODE_ENV == 'dev') plugins.push('livereload');

module.exports = {
  title: 'Youling Tang',
  author: 'tangyouling',
  lang: 'zh-cn',
  description: '个人网站示例项目',
  plugins,
  pluginsConfig: {
    // github 插件配置
    github: {
      url: 'https://github.com/tangyouling/blog_gitbook.git',
    },
    // gitbook-plugin-code 插件配置
    code: {
      copyButtons: true, // code插件复制按钮
    },
    // gitbook-plugin-theme-lou 主题插件配置
    'theme-lou': {
      color: '#000000', // 主题色
      //color: '#2096FF', // 主题色
      favicon: 'assets/favicon.png', // 网站图标
      logo: 'assets/logo.png', // Logo图
      //copyrightLogo: 'assets/copyright.png', // 背景水印版权图
      autoNumber: 3, // 自动给标题添加编号(如1.1.1)
      titleColor: {
        // 自定义标题颜色(不设置则默认使用主题色)
        //h1: '#8b008b', // 一级标题颜色
        //h2: '#20b2aa', // 二级标题颜色
        //h3: '#a52a2a', // 三级标题颜色
      },
      forbidCopy: false, // 页面是否禁止复制（不影响code插件的复制）
      'search-placeholder': 'Search', // 搜索框默认文本
      'hide-elements': ['.summary .gitbook-link'], // 需要隐藏的标签
      copyright: {
        author: 'Youling Tang', // 底部版权展示的作者名
      },
    },
  },
  variables: {
    themeLou: {
      // 顶部导航栏配置
      nav: [
	/* GitHub 导航栏 */
        {
          target: '_blank', // 跳转方式: 打开新页面
          url: 'https://github.com/tangyouling', // 跳转页面
          name: 'GitHub', // Github导航名称
        },
	/* Gitee 导航栏 */
        {
          target: '_blank', // 跳转方式: 打开新页面
          url: 'https://gitee.com/tangyouling', // 跳转页面
          name: 'Gitee', // 导航名称
        },
	/* Email 导航栏 */
        {
          target: '_blank', // 跳转方式: 打开新页面
          url: 'mailto: Youling Tang <youling.tang@linux.dev>', // 跳转到邮件发送界面
          name: 'Email', // 导航名称
        },
      ],
      // 底部配置
      footer: {
        copyright: true, // 显示版权
      },
    },
  },
};
