import React,{useState} from 'react';
import {Outlet,Link,NavLink,useLocation} from 'react-router-dom';
import {ArrowRight,Menu,X,ArrowUpRight,Mail,MapPin,Phone} from 'lucide-react';
import {Logo} from './Common';
import {useAuth} from '../Auth';

const links=[['Home','/'],['About','/about'],['Academics','/academics'],['Admissions','/admissions'],['News & Events','/news'],['Contact','/contact']];
export function PublicLayout(){
 const [open,setOpen]=useState(false); const {auth}=useAuth(); const loc=useLocation();
 React.useEffect(()=>{setOpen(false);window.scrollTo({top:0,behavior:'instant'});},[loc.pathname]);
 return <div className="public-site">
  <div className="utility-bar"><div className="public-wrap utility-inner"><span><span className="utility-spark">✦</span> A place to learn, grow and belong.</span><span>DEMO EXPERIENCE <i/> Sample information, not official records</span></div></div>
  <header className="public-header"><div className="public-wrap header-inner"><Logo/>
   <nav className="public-nav" aria-label="Main navigation">{links.map(([label,url])=><NavLink key={url} to={url} end={url==='/'}>{label}</NavLink>)}</nav>
   <div className="header-actions"><Link className="header-login" to={auth?'/portal/dashboard':'/login'}>{auth?'My portal':'Portal login'} <ArrowUpRight size={15}/></Link><Link className="button button-primary button-sm" to="/admissions">Apply now <ArrowRight size={15}/></Link></div>
   <button className="mobile-menu-toggle icon-button" onClick={()=>setOpen(!open)} aria-label={open?'Close menu':'Open menu'} aria-expanded={open}>{open?<X/>:<Menu/>}</button>
  </div>{open&&<div className="mobile-public-menu">{links.map(([label,url])=><NavLink key={url} to={url}>{label}<ArrowRight size={16}/></NavLink>)}<Link to={auth?'/portal/dashboard':'/login'}>Portal login <ArrowRight size={16}/></Link></div>}</header>
  <main><Outlet/></main>
  <footer className="public-footer"><div className="public-wrap"><div className="footer-top"><div className="footer-about"><Logo light/><p>Inspiring curious minds and nurturing confident learners, one bright future at a time.</p><span className="footer-note">A demonstration website for USMANIYYA ACADEMY.</span></div><div><h4>Discover</h4><Link to="/about">About our school</Link><Link to="/academics">Academics</Link><Link to="/staff">Staff directory</Link><Link to="/news">News & events</Link></div><div><h4>Get started</h4><Link to="/admissions">Admissions</Link><Link to="/login?role=student">Student portal</Link><Link to="/login?role=parent">Parent portal</Link><Link to="/contact">Contact us</Link></div><div><h4>Stay connected</h4><p className="footer-contact"><MapPin size={15}/> Address to be confirmed</p><p className="footer-contact"><Phone size={15}/> Phone to be confirmed</p><p className="footer-contact"><Mail size={15}/> Email to be confirmed</p><span className="footer-note">Official contact and social links can be added when provided.</span></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} USMANIYYA ACADEMY. All rights reserved.</span><span>Made for brighter futures <span className="footer-heart">✦</span></span></div></div></footer>
 </div>;
}
