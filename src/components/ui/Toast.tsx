import { create } from 'zustand'

interface ToastStore {
  message: string
  visible: boolean
  show: (msg: string, duration?: number) => void
}

export const useToast = create<ToastStore>((set) => ({
  message: '',
  visible: false,
  show: (msg, duration = 2200) => {
    set({ message: msg, visible: true })
    setTimeout(() => set({ visible: false }), duration)
  },
}))

export function Toast() {
  const { message, visible } = useToast()
  return (
    <div className={`toast${visible ? ' show' : ''}`}>
      {message}
    </div>
  )
}
