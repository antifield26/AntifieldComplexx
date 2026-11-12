/** 移动端的次级功能入口；分享开关沿用服务端元数据，页面不额外读取或展示个人数据。 */
import { Link } from 'react-router-dom'
import { Activity, ArrowUpRight, BookOpen, Bot, Settings, Share2, Trash } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useAppMeta } from '../meta/MetaContext'

const ENTRIES = [
  { to: '/knowledge', label: '知识库', hint: '笔记、书签与附件', icon: BookOpen },
  { to: '/shares', label: '分享', hint: '管理公开链接与访问权限', icon: Share2 },
  { to: '/trash', label: '回收站', hint: '恢复或清理已删除文件', icon: Trash },
  { to: '/chatbots', label: '机器人', hint: 'QQ 机器人接入说明', icon: Bot },
  { to: '/activity', label: '活动', hint: '最近操作与审计记录', icon: Activity },
  { to: '/settings', label: '设置', hint: '账号、设备、安全与备份', icon: Settings },
]

export function More() {
  const { meta } = useAppMeta()
  return (
    <div className="more-page">
      <PageHeader title="更多" description="你的知识、连接与个人设置" />
      <nav className="more-grid" aria-label="更多功能">
        {ENTRIES.filter((entry) => entry.to !== '/shares' || meta.sharesEnabled).map((entry) => (
          <Link key={entry.to} to={entry.to} className="more-entry">
            <span className="more-entry-icon"><entry.icon size={23} aria-hidden="true" /></span>
            <span className="more-entry-text"><strong>{entry.label}</strong><span>{entry.hint}</span></span>
            <ArrowUpRight className="more-entry-arrow" size={17} aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </div>
  )
}
