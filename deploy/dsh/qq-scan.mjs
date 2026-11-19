/** 隔离扫码连接器的输出。只经父进程 IPC 传递一次性二维码或绑定结果。 */
import { startQrConnect } from '@tencent-connect/qqbot-connector'
import QRCode from 'qrcode'

const abort = new AbortController()
process.once('disconnect', () => abort.abort())
const send = (value) => { if (process.connected) process.send(value) }
startQrConnect({
  onQrDisplayed: (url) => {
    if (typeof url !== 'string' || url.length > 2048 || !url.startsWith('https://')) {
      send({ failed: true })
      return
    }
    void QRCode.toDataURL(url, { width: 256 }).then(qr => send({ qr }), () => send({ failed: true }))
  },
  onFailure: () => send({ failed: true }),
  onSuccess: (credentials) => {
    const selected = credentials[0]
    send(selected ? { appId: selected.appId, appSecret: selected.appSecret } : { failed: true })
  },
}, { displayQrCodeToConsole: false, signal: abort.signal, source: 'dsh-qqbot' })
