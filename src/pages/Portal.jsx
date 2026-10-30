import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
import {Link,Navigate,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {LayoutDashboard,UserRound,CalendarCheck,CalendarDays,BookOpen,ClipboardList,GraduationCap,BookMarked,WalletCards,LibraryBig,Megaphone,Images,MessagesSquare,LifeBuoy,LogOut,Bell,Search,ChevronDown,ChevronRight,Menu,MoreHorizontal,X,UsersRound,School,ContactRound,Settings,FileBarChart,ScrollText,CalendarRange,ShieldCheck,NotebookPen,Check,ArrowRight} from 'lucide-react';
import {useAuth} from '../Auth';
import {api,post,patch} from '../api';
import {Avatar,Logo,Loading,ErrorBox,Initials} from '../components/Common';
import {StudentDashboard,StudentSection,Receipt} from './StudentViews';
import {TeacherDashboard,AdminDashboard,TeacherSection,AdminSection} from './StaffViews';
import {CalendarView,EventsView,NoticesView,MessagesView,LibraryView,ProfileView,GalleryView,HelpView,IdCard} from './SharedViews';

const studentItems=[['dashboard','Overview',LayoutDashboard],['profile','My profile',UserRound],['attendance','Attendance',CalendarCheck],['timetable','Timetable',CalendarDays],['assignments','Assignments',ClipboardList],['grades','Grade sheet',FileBarChart],['subjects','My subjects',BookOpen],['exams','Examinations',GraduationCap],['fees','Fees & payments',WalletCards],['library','Library',LibraryBig],['notices','Notices',Megaphone],['events','Events',CalendarDays],['calendar','Academic calendar',CalendarRange],['gallery','Gallery',Images],['messages','Messages',MessagesSquare]];
const parentItems=[['dashboard','Overview',LayoutDashboard],['children','My children',UsersRound],['attendance','Attendance',CalendarCheck],['timetable','Timetable',CalendarDays],['assignments','Assignments',ClipboardList],['grades','Results',FileBarChart],['fees','Fees & payments',WalletCards],['subjects','Subjects',BookOpen],['exams','Examinations',GraduationCap],['library','Library',LibraryBig],['notices','Notices',Megaphone],['events','Events',CalendarDays],['calendar','Academic calendar',CalendarRange],['messages','Messages',MessagesSquare],['profile','My profile',UserRound]];
const teacherItems=[['dashboard','Overview',LayoutDashboard],['classes','My classes',School],['attendance','Attendance',CalendarCheck],['timetable','Timetable',CalendarDays],['assignments','Assignments',ClipboardList],['results','Results',FileBarChart],['exams','Examinations',GraduationCap],['library','Library',LibraryBig],['notices','Notices',Megaphone],['events','Events',CalendarDays],['calendar','Academic calendar',CalendarRange],['messages','Messages',MessagesSquare],['profile','My profile',UserRound]];
const adminItems=[['dashboard','Overview',LayoutDashboard],['students','Students',UsersRound],['staff','Teachers & staff',ContactRound],['parents','Parents',UserRound],['academics','Academics',School],['timetable','Timetable',CalendarDays],['attendance','Attendance',CalendarCheck],['exams','Examinations',GraduationCap],['results','Results',FileBarChart],['fees','Finance',WalletCards],['library','Library',LibraryBig],['notices','Announcements',Megaphone],['events','Events',CalendarDays],['applications','Applications',ClipboardList],['users','User accounts',ShieldCheck],['audit','Audit log',ScrollText],['calendar','Academic calendar',CalendarRange],['messages','Messages',MessagesSquare],['profile','My profile',UserRound]];
export const navFor=role=>role==='parent'?parentItems:role==='teacher'?teacherItems:role==='admin'?adminItems:studentItems;
const PortalContext=createContext(null);
export const usePortal=()=>useContext(PortalContext);
function PortalProvider({children}){
 const {auth}=useAuth(),user=auth.user; const [selectedStudent,setSelectedStudent]=useState(auth.children?.[0]?.id||null);
 const [data,setData]=useState(null),[events,setEvents]=useState([]),[announcements,setAnnouncements]=useState([]),[books,setBooks]=useState([]),[notifications,setNotifications]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const load=async(silent=false)=>{if(!silent)setLoading(true);setError('');try{
  const roleData=(user.role==='student'||user.role==='parent')?(selectedStudent?api(`/student/${selectedStudent}/data`):Promise.resolve(null)):api(`/${user.role}/data`);
  const [d,e,a,b,n]=await Promise.all([roleData,api('/events'),api('/announcements'),api('/books'),api('/notifications')]);setData(d);setEvents(e);setAnnouncements(a);setBooks(b);setNotifications(n);
 }catch(e){setError(e.message)}finally{setLoading(false)}};
 useEffect(()=>{load(false)},[user.id,selectedStudent]);
 const markRead=async(id)=>{try{await patch(`/notifications/${id}/read`);setNotifications(prev=>prev.map(n=>n.id===id?{...n,is_read:1}:n))}catch(e){setError(e.message)}};
 const markAll=async()=>{try{await post('/notifications/read-all');setNotifications(prev=>prev.map(n=>({...n,is_read:1})))}catch(e){setError(e.message)}};
 return <PortalContext.Provider value={{user,auth,data,events,announcements,books,notifications,loading,error,refresh:()=>load(true),retry:()=>load(false),selectedStudent,setSelectedStudent,markRead,markAll}}>{children}</PortalContext.Provider>
}
export function Portal(){const {auth,loading}=useAuth(); if(loading)return <Loading label="Opening your portal…"/>;if(!auth)return <Navigate to="/login" replace/>;return <PortalProvider><PortalShell/></PortalProvider>}
function PortalShell(){
 const {user,auth,notifications,markRead,markAll,selectedStudent,setSelectedStudent}=usePortal();const {logout}=useAuth();const location=useLocation(),navigate=useNavigate();
 const [search,setSearch]=useState(''),[searchOpen,setSearchOpen]=useState(false),[noticesOpen,setNoticesOpen]=useState(false),[moreOpen,setMoreOpen]=useState(false);
 const items=navFor(user.role),section=location.pathname.split('/')[2]||'dashboard',active=items.find(i=>i[0]===section)?.[1]||'Overview',unread=notifications.filter(x=>!x.is_read).length;
 const matches=search?items.filter(i=>i[1].toLowerCase().includes(search.toLowerCase())).slice(0,6):[];
 useEffect(()=>{setMoreOpen(false);setSearch('');setSearchOpen(false);window.scrollTo({top:0,behavior:'instant'})},[location.pathname]);
 const goSearch=(id)=>{navigate('/portal/'+id);setSearch('');setSearchOpen(false)};
 async function signout(){await logout();navigate('/login')}
 return <div className="portal-app">
  <aside className="portal-sidebar"><div className="sidebar-logo"><Logo/></div><div className="sidebar-overline">YOUR WORKSPACE</div><div className="sidebar-scroll"><div className="sidebar-group-label">MAIN MENU</div><nav aria-label="Portal navigation" className="sidebar-nav">{items.map(([id,label,Icon],index)=><React.Fragment key={id}>{index===6&&<div className="sidebar-group-label sidebar-second">EXPLORE</div>}<Link to={'/portal/'+id} className={'side-link '+(section===id?'active':'')}><Icon size={18}/><span>{label}</span>{section===id&&<span className="side-active-dot"/>}</Link></React.Fragment>)}</nav><div className="sidebar-group-label sidebar-second">SUPPORT</div><Link to="/portal/help" className={'side-link '+(section==='help'?'active':'')}><LifeBuoy size={18}/><span>Help & support</span></Link></div><div className="sidebar-bottom"><div className="sidebar-demo"><span className="demo-dot"/> DEMO WORKSPACE <small>Sample data only</small></div><button onClick={signout} className="sidebar-logout"><LogOut size={17}/> Sign out</button></div></aside>
  <div className="portal-right"><header className="portal-topbar"><div className="portal-top-left"><div className="portal-mobile-logo"><Logo compact/></div><div className="breadcrumb"><span>{user.role.charAt(0).toUpperCase()+user.role.slice(1)} portal</span><ChevronRight size={14}/><strong>{active}</strong></div></div><div className="top-actions"><div className="portal-search"><Search size={17}/><input aria-label="Search portal navigation" value={search} onFocus={()=>setSearchOpen(true)} onChange={e=>{setSearch(e.target.value);setSearchOpen(true)}} onKeyDown={e=>{if(e.key==='Enter'&&matches[0])goSearch(matches[0][0]);if(e.key==='Escape')setSearchOpen(false)}} placeholder="Search your portal..."/>{search&&<button onClick={()=>setSearch('')} aria-label="Clear search"><X size={15}/></button>}{searchOpen&&search&&<div className="search-results">{matches.length?matches.map(([id,label,Icon])=><button key={id} onMouseDown={e=>e.preventDefault()} onClick={()=>goSearch(id)}><Icon size={16}/>{label}<ChevronRight size={15}/></button>):<p>No matching sections</p>}</div>}</div><span className="topbar-divider"/><div className="notification-wrap"><button className={'top-icon '+(noticesOpen?'pressed':'')} onClick={()=>setNoticesOpen(!noticesOpen)} aria-label={`Notifications, ${unread} unread`} aria-expanded={noticesOpen}><Bell size={20}/>{unread>0&&<span className="notification-count">{unread>9?'9+':unread}</span>}</button>{noticesOpen&&<div className="notification-popover"><div className="notification-title"><div><b>Notifications</b><small>{unread} unread</small></div><button onClick={markAll}>Mark all read</button></div><div className="notification-list">{notifications.length?notifications.map(n=><button className={'notification-row '+(!n.is_read?'unread':'')} key={n.id} onClick={()=>markRead(n.id)}><span className="notif-icon"><Bell size={15}/></span><span><b>{n.title}</b><small>{n.body}</small></span>{!n.is_read&&<i/>}</button>):<p className="notif-empty">You’re all caught up.</p>}</div></div>}</div><Link to="/portal/profile" className="top-user"><Avatar user={user}/><span><b>{user.name}</b><small>{user.role==='admin'?'Administrator':user.role.charAt(0).toUpperCase()+user.role.slice(1)}</small></span><ChevronRight size={15}/></Link></div></header>
   <main className="portal-main"><div className="mobile-portal-search"><Search size={17}/><input value={search} onChange={e=>{setSearch(e.target.value);setSearchOpen(true)}} placeholder="Search your portal..." aria-label="Search your portal"/>{search&&<button onClick={()=>setSearch('')}><X size={15}/></button>}{searchOpen&&search&&<div className="search-results">{matches.length?matches.map(([id,label,Icon])=><button key={id} onClick={()=>goSearch(id)}><Icon size={16}/>{label}<ChevronRight size={15}/></button>):<p>No matching sections</p>}</div>}</div>
    {user.role==='parent'&&auth.children?.length>1&&<div className="child-switch"><span>Viewing learner</span><select value={selectedStudent||''} onChange={e=>setSelectedStudent(Number(e.target.value))}>{auth.children.map(child=><option key={child.id} value={child.id}>{child.name} · {child.class_name}</option>)}</select></div>}
    <div className="portal-page"><Routes><Route index element={<Navigate to="dashboard" replace/>}/><Route path="receipt/:id" element={<Receipt/>}/><Route path=":section" element={<PortalContent/>}/><Route path="*" element={<Navigate to="dashboard" replace/>}/></Routes></div>
   </main>
  </div>
  <nav className="mobile-bottom-nav" aria-label="Mobile portal navigation"><Link className={section==='dashboard'?'active':''} to="/portal/dashboard"><LayoutDashboard/><span>Home</span></Link><Link className={section==='calendar'?'active':''} to="/portal/calendar"><CalendarDays/><span>Calendar</span></Link><Link className={section==='messages'?'active':''} to="/portal/messages"><MessagesSquare/><span>Messages</span></Link><button className={moreOpen?'active':''} onClick={()=>setMoreOpen(!moreOpen)}><MoreHorizontal/><span>More</span></button></nav>
  {moreOpen&&<div className="more-overlay" onClick={()=>setMoreOpen(false)}><div className="more-sheet" onClick={e=>e.stopPropagation()}><div className="more-head"><div><small>YOUR WORKSPACE</small><h3>Explore your portal</h3></div><button onClick={()=>setMoreOpen(false)} aria-label="Close menu"><X/></button></div><div className="more-grid">{items.map(([id,label,Icon])=><Link key={id} to={'/portal/'+id}><span><Icon size={19}/></span>{label}</Link>)}<Link to="/portal/help"><span><LifeBuoy size={19}/></span>Help & support</Link></div><button className="more-logout" onClick={signout}><LogOut size={17}/> Sign out</button></div></div>}
 </div>;
}
function PortalContent(){
 const {user,loading,error,retry,data}=usePortal();const location=useLocation();const section=location.pathname.split('/')[2]||'dashboard';
 if(loading)return <Loading/>;if(error&&!data)return <div className="portal-error"><ErrorBox message={error}/><button className="button button-outline" onClick={retry}>Try again</button></div>;
 if(section==='dashboard')return user.role==='admin'?<AdminDashboard/>:user.role==='teacher'?<TeacherDashboard/>:<StudentDashboard/>;
 if(section==='profile')return <ProfileView/>;
 if(section==='calendar')return <CalendarView/>;
 if(section==='events')return <EventsView/>;
 if(section==='notices')return <NoticesView/>;
 if(section==='messages')return <MessagesView/>;
 if(section==='library')return <LibraryView/>;
 if(section==='gallery')return <GalleryView/>;
 if(section==='help')return <HelpView/>;
 if(section==='id-card')return <IdCard/>;
 if(user.role==='teacher')return <TeacherSection section={section}/>;
 if(user.role==='admin')return <AdminSection section={section}/>;
 return <StudentSection section={section}/>;
}
