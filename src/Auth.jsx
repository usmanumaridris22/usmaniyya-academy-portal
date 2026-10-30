import React,{createContext,useContext,useEffect,useState} from 'react';
import {api,post} from './api';
const AuthContext=createContext(null);
export function AuthProvider({children}) {
  const [auth,setAuth]=useState(null),[loading,setLoading]=useState(true);
  useEffect(()=>{api('/auth/me').then(setAuth).catch(()=>setAuth(null)).finally(()=>setLoading(false));},[]);
  async function login(email,password,role){const result=await post('/auth/login',{email,password,role});setAuth(result);return result;}
  async function logout(){try{await post('/auth/logout')}finally{setAuth(null)}}
  async function refresh(){const result=await api('/auth/me');setAuth(result);}
  return <AuthContext.Provider value={{auth,loading,login,logout,refresh,setAuth}}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>useContext(AuthContext);
