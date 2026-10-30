export async function api(path, options={}) {
  const response = await fetch('/api'+path, { credentials:'same-origin', ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers||{}) }, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  let data; try { data=await response.json(); } catch { data={error:'Unexpected response from the server.'}; }
  if(!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
export const post=(path,body={})=>api(path,{method:'POST',body});
export const patch=(path,body={})=>api(path,{method:'PATCH',body});
export const money = kobo => '₦'+(Number(kobo||0)/100).toLocaleString('en-NG',{maximumFractionDigits:2});
export const dateFormat = (value,opts={day:'numeric',month:'short',year:'numeric'}) => { if(!value)return '—'; const normalized=value.replace(' ','T'); const d = new Date(value.length===10 ? value+'T12:00:00' : /(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : normalized+'Z'); return Number.isNaN(d.getTime())?value:d.toLocaleDateString('en-GB',opts); };
export const timeFormat = value => { if(!value)return ''; const [h,m]=value.split(':').map(Number); return `${String(h%12||12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; };
export const todayString = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
