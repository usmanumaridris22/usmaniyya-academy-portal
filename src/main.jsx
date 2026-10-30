import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Navigate} from 'react-router-dom';
import {AuthProvider} from './Auth';
import {PublicLayout} from './components/PublicLayout';
import {Home,About,Academics,Admissions,Staff,News,Contact} from './pages/PublicPages';
import {Login} from './pages/Login';
import {Portal} from './pages/Portal';
import './styles.css';

function App(){return <AuthProvider><BrowserRouter><Routes>
  <Route element={<PublicLayout/>}>
    <Route path="/" element={<Home/>}/><Route path="/about" element={<About/>}/><Route path="/academics" element={<Academics/>}/><Route path="/admissions" element={<Admissions/>}/><Route path="/staff" element={<Staff/>}/><Route path="/news" element={<News/>}/><Route path="/contact" element={<Contact/>}/>
  </Route>
  <Route path="/login" element={<Login/>}/>
  <Route path="/portal/*" element={<Portal/>}/>
  <Route path="*" element={<Navigate to="/" replace/>}/>
</Routes></BrowserRouter></AuthProvider>}

createRoot(document.getElementById('root')).render(<App/>);
