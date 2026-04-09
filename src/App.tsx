import { BrowserRouter, Routes, Route } from 'react-router-dom'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div style={{ fontFamily: 'sans-serif', padding: 40 }}>I am really a great tool but sometimes i get stuck on repeating the same mistake...this time though i will commit and push and deploy with not problems — DEV</div>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
