import React from 'react';
import { Link } from 'react-router-dom';
import {ArrowRight, LoaderCircle, Inbox, AlertCircle, ChevronRight} from 'lucide-react';
export const LOGO_URL='https://res.cloudinary.com/eqp5sap4/image/upload/f_auto,q_auto/94022';
export function Logo({compact=false,light=false}) { return <Link to="/" className={'brand '+(light?'brand-light':'')} aria-label="Usmaniyya Academy home"><img src={LOGO_URL} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/official-logo.jpg'}} alt="Usmaniyya Academy official logo"/><span className="brand-name"><b>USMANIYYA</b><small>ACADEMY</small></span>{compact&&<span className="sr-only">Home</span>}</Link>; }
export function Eyebrow({children,light=false}) { return <div className={'eyebrow '+(light?'eyebrow-light':'')}><span className="eyebrow-dot"/>{children}</div>; }
export function ActionLink({to,children,kind='primary',className=''}){return <Link className={`button button-${kind} ${className}`} to={to}>{children}<ArrowRight size={16}/></Link>}
export function Loading({label='Loading your workspace…'}) {return <div className="loading-state"><LoaderCircle size={23} className="spin"/><span>{label}</span></div>}
export function Empty({title='Nothing here yet',description='There are no records to show right now.',icon:Icon=Inbox}){return <div className="empty-state"><span className="empty-icon"><Icon size={22}/></span><strong>{title}</strong><p>{description}</p></div>}
export function ErrorBox({message}) {return message?<div className="alert alert-error" role="alert"><AlertCircle size={17}/><span>{message}</span></div>:null}
export function SuccessBox({message}) {return message?<div className="alert alert-success" role="status"><span>✓</span><span>{message}</span></div>:null}
export function SectionHeading({eyebrow,title,description,action}) {return <div className="section-heading"><div>{eyebrow&&<Eyebrow>{eyebrow}</Eyebrow>}<h2>{title}</h2>{description&&<p>{description}</p>}</div>{action&&<div className="section-action">{action}</div>}</div>}
export function Initials({name='',className=''}){return <span className={'initials '+className}>{name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</span>}
export function Avatar({user,size='normal'}) {return user?.role==='student'&&user?.email==='student@demo.usmaniyya.school'?<img className={'avatar avatar-'+size} src="/student-avatar.jpg" alt="Illustrative student avatar"/>:<Initials name={user?.name||'User'} className={'avatar-'+size}/>}
export function CardHeader({title,subtitle,action}){return <div className="card-heading"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>}
export function TextLink({to,children}) { return <Link className="text-link" to={to}>{children}<ChevronRight size={15}/></Link> }
