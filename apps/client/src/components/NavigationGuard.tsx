/** 数据路由的离开确认，所有站内导航共享同一未保存检查。 */
import { useBlocker } from 'react-router-dom'
import { hasUnsavedChanges } from '../lib/navigation-guard'
import { ConfirmDialog } from './ConfirmDialog'

export function NavigationGuard() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasUnsavedChanges() && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  ))
  return <ConfirmDialog open={blocker.state === 'blocked'} title="离开当前页面？"
    message="当前内容尚未保存，离开后将丢失本次修改。" confirmText="放弃并离开" cancelText="继续编辑"
    onConfirm={() => { if (blocker.state === 'blocked') blocker.proceed() }}
    onClose={() => { if (blocker.state === 'blocked') blocker.reset() }} />
}
