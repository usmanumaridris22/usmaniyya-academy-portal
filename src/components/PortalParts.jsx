import React from 'react';
import {ArrowLeft,Inbox} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Empty} from './Common';
export function PageHeading({eyebrow,title,description,action}){return <div className="portal-page-heading"><div>{eyebrow&&<div className="portal-page-eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{action&&<div className="page-heading-action">{action}</div>}</div>}
export function Surface({children,className=''}){return <section className={'surface '+className}>{children}</section>}
export function SurfaceHeading({title,description,action}){return <div className="surface-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</div>}
export function Badge({children,tone='purple'}){return <span className={'badge badge-'+tone}>{children}</span>}
export function DataTable({columns,rows,emptyTitle='No records yet',emptyDescription='There are no records to show right now.'}){return rows?.length?<div className="table-scroll"><table className="data-table"><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={row.id??i}>{columns.map(c=><td key={c.key}>{c.render?c.render(row,i):row[c.key]??'—'}</td>)}</tr>)}</tbody></table></div>:<Empty title={emptyTitle} description={emptyDescription} icon={Inbox}/>}
export function PortalButton({children,onClick,kind='primary',type='button',disabled=false,icon:Icon}){return <button type={type} onClick={onClick} disabled={disabled} className={'button button-'+kind+' button-sm'}>{children}{Icon&&<Icon size={15}/>}</button>}
export function BackLink({to='/portal/dashboard',children='Back to dashboard'}){return <Link to={to} className="back-link"><ArrowLeft size={15}/>{children}</Link>}
export function Field({label,children,hint}){return <label>{label}{children}{hint&&<small>{hint}</small>}</label>}
