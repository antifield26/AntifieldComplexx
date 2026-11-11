import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { setNativeBridgeForTests } from '../lib/native'

afterEach(() => {
  setNativeBridgeForTests(null)
})
