import { BrowserRouter, Routes, Route } from 'react-router-dom'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div style={{ fontFamily: 'sans-serif', padding: 40 }}>I am commiting this to Dev first and then to prod.</div>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
