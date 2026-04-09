import { BrowserRouter, Routes, Route } from 'react-router-dom'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div style={{ fontFamily: 'sans-serif', padding: 40 }}>I am trying to be a rockstar but sometimes I am just an AI</div>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
