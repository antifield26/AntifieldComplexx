/** 文件及附件缩略图。原生传输失败时不退回无签名地址。 */
import type { ImgHTMLAttributes } from 'react'
import { useFileContentUrl } from '../../hooks/useFileContentUrl'

export function AuthenticatedImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const { url, error } = useFileContentUrl(typeof src === 'string' ? src : null)
  if (error) return <span className="field-hint" role="img" aria-label={alt || '图片预览不可用'}>图片预览不可用</span>
  return <img {...props} src={url ?? undefined} alt={alt ?? ''} />
}
