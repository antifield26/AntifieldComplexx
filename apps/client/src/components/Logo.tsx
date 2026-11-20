import { cx } from '../lib/classnames'

export interface LogoProps {
  size?: number
  withText?: boolean
  className?: string
}

/** 石墨底暖橙几何徽记；登录页与侧栏共用。 */
export function Logo({ size = 36, withText = false, className }: LogoProps) {
  return (
    <span className={cx('logo', className)}>
      <span
        className="logo-mark"
        style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` }}
        aria-hidden="true"
      >
        <img src="/favicon.svg" width={size} height={size} alt="" />
      </span>
      {withText ? (
        <span className="logo-text">
          <strong className="logo-name">AntifieldComplexx</strong>
          <span className="logo-subtitle">个人综合交互平台</span>
        </span>
      ) : null}
    </span>
  )
}
