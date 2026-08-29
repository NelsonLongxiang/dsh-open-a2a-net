var Dc=Object.defineProperty;var Ic=(i,e,t)=>e in i?Dc(i,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):i[e]=t;var ei=(i,e,t)=>Ic(i,typeof e!="symbol"?e+"":e,t);(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function t(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(s){if(s.ep)return;s.ep=!0;const r=t(s);fetch(s.href,r)}})();/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Va="169",vi={ROTATE:0,DOLLY:1,PAN:2},_i={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Nc=0,po=1,Uc=2,Ol=1,Fc=2,cn=3,Ln=0,wt=1,hn=2,Cn=0,xi=1,mo=2,_o=3,go=4,Oc=5,Gn=100,Bc=101,zc=102,kc=103,Hc=104,Gc=200,Vc=201,Wc=202,Xc=203,Qr=204,ea=205,Yc=206,qc=207,jc=208,Kc=209,$c=210,Zc=211,Jc=212,Qc=213,eh=214,ta=0,na=1,ia=2,bi=3,sa=4,ra=5,aa=6,oa=7,Bl=0,th=1,nh=2,Pn=0,ih=1,sh=2,rh=3,ah=4,oh=5,lh=6,ch=7,zl=300,Ti=301,Ai=302,la=303,ca=304,Qs=306,ha=1e3,Wn=1001,ua=1002,zt=1003,hh=1004,ss=1005,qt=1006,fr=1007,Xn=1008,pn=1009,kl=1010,Hl=1011,qi=1012,Wa=1013,Yn=1014,un=1015,ji=1016,Xa=1017,Ya=1018,wi=1020,Gl=35902,Vl=1021,Wl=1022,Kt=1023,Xl=1024,Yl=1025,Mi=1026,Ri=1027,ql=1028,qa=1029,jl=1030,ja=1031,Ka=1033,Ls=33776,Ds=33777,Is=33778,Ns=33779,da=35840,fa=35841,pa=35842,ma=35843,_a=36196,ga=37492,va=37496,xa=37808,Ma=37809,Sa=37810,ya=37811,Ea=37812,ba=37813,Ta=37814,Aa=37815,wa=37816,Ra=37817,Ca=37818,Pa=37819,La=37820,Da=37821,Us=36492,Ia=36494,Na=36495,Kl=36283,Ua=36284,Fa=36285,Oa=36286,uh=3200,dh=3201,$l=0,fh=1,Tn="",Zt="srgb",In="srgb-linear",$a="display-p3",er="display-p3-linear",Hs="linear",at="srgb",Gs="rec709",Vs="p3",ti=7680,vo=519,ph=512,mh=513,_h=514,Zl=515,gh=516,vh=517,xh=518,Mh=519,xo=35044,Mo="300 es",dn=2e3,Ws=2001;class $n{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const s=this._listeners[e];if(s!==void 0){const r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const n=this._listeners[e.type];if(n!==void 0){e.target=this;const s=n.slice(0);for(let r=0,a=s.length;r<a;r++)s[r].call(this,e);e.target=null}}}const St=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Fs=Math.PI/180,Ba=180/Math.PI;function Ki(){const i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(St[i&255]+St[i>>8&255]+St[i>>16&255]+St[i>>24&255]+"-"+St[e&255]+St[e>>8&255]+"-"+St[e>>16&15|64]+St[e>>24&255]+"-"+St[t&63|128]+St[t>>8&255]+"-"+St[t>>16&255]+St[t>>24&255]+St[n&255]+St[n>>8&255]+St[n>>16&255]+St[n>>24&255]).toLowerCase()}function bt(i,e,t){return Math.max(e,Math.min(t,i))}function Sh(i,e){return(i%e+e)%e}function pr(i,e,t){return(1-t)*i+t*e}function Ni(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Tt(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}const yh={DEG2RAD:Fs};class Ue{constructor(e=0,t=0){Ue.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(bt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,a=this.y-e.y;return this.x=r*n-a*s+e.x,this.y=r*s+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Ge{constructor(e,t,n,s,r,a,o,l,c){Ge.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c)}set(e,t,n,s,r,a,o,l,c){const h=this.elements;return h[0]=e,h[1]=s,h[2]=o,h[3]=t,h[4]=r,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],m=n[7],p=n[2],u=n[5],_=n[8],M=s[0],f=s[3],d=s[6],E=s[1],S=s[4],T=s[7],z=s[2],D=s[5],A=s[8];return r[0]=a*M+o*E+l*z,r[3]=a*f+o*S+l*D,r[6]=a*d+o*T+l*A,r[1]=c*M+h*E+m*z,r[4]=c*f+h*S+m*D,r[7]=c*d+h*T+m*A,r[2]=p*M+u*E+_*z,r[5]=p*f+u*S+_*D,r[8]=p*d+u*T+_*A,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8];return t*a*h-t*o*c-n*r*h+n*o*l+s*r*c-s*a*l}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],m=h*a-o*c,p=o*l-h*r,u=c*r-a*l,_=t*m+n*p+s*u;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);const M=1/_;return e[0]=m*M,e[1]=(s*c-h*n)*M,e[2]=(o*n-s*a)*M,e[3]=p*M,e[4]=(h*t-s*l)*M,e[5]=(s*r-o*t)*M,e[6]=u*M,e[7]=(n*l-c*t)*M,e[8]=(a*t-n*r)*M,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,a,o){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*a+c*o)+a+e,-s*c,s*l,-s*(-c*a+l*o)+o+t,0,0,1),this}scale(e,t){return this.premultiply(mr.makeScale(e,t)),this}rotate(e){return this.premultiply(mr.makeRotation(-e)),this}translate(e,t){return this.premultiply(mr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const mr=new Ge;function Jl(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Xs(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Eh(){const i=Xs("canvas");return i.style.display="block",i}const So={};function Os(i){i in So||(So[i]=!0,console.warn(i))}function bh(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}function Th(i){const e=i.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function Ah(i){const e=i.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}const yo=new Ge().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),Eo=new Ge().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),Ui={[In]:{transfer:Hs,primaries:Gs,luminanceCoefficients:[.2126,.7152,.0722],toReference:i=>i,fromReference:i=>i},[Zt]:{transfer:at,primaries:Gs,luminanceCoefficients:[.2126,.7152,.0722],toReference:i=>i.convertSRGBToLinear(),fromReference:i=>i.convertLinearToSRGB()},[er]:{transfer:Hs,primaries:Vs,luminanceCoefficients:[.2289,.6917,.0793],toReference:i=>i.applyMatrix3(Eo),fromReference:i=>i.applyMatrix3(yo)},[$a]:{transfer:at,primaries:Vs,luminanceCoefficients:[.2289,.6917,.0793],toReference:i=>i.convertSRGBToLinear().applyMatrix3(Eo),fromReference:i=>i.applyMatrix3(yo).convertLinearToSRGB()}},wh=new Set([In,er]),et={enabled:!0,_workingColorSpace:In,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(i){if(!wh.has(i))throw new Error(`Unsupported working color space, "${i}".`);this._workingColorSpace=i},convert:function(i,e,t){if(this.enabled===!1||e===t||!e||!t)return i;const n=Ui[e].toReference,s=Ui[t].fromReference;return s(n(i))},fromWorkingColorSpace:function(i,e){return this.convert(i,this._workingColorSpace,e)},toWorkingColorSpace:function(i,e){return this.convert(i,e,this._workingColorSpace)},getPrimaries:function(i){return Ui[i].primaries},getTransfer:function(i){return i===Tn?Hs:Ui[i].transfer},getLuminanceCoefficients:function(i,e=this._workingColorSpace){return i.fromArray(Ui[e].luminanceCoefficients)}};function Si(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function _r(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let ni;class Rh{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{ni===void 0&&(ni=Xs("canvas")),ni.width=e.width,ni.height=e.height;const n=ni.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=ni}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=Xs("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let a=0;a<r.length;a++)r[a]=Si(r[a]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Si(t[n]/255)*255):t[n]=Si(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let Ch=0;class Ql{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Ch++}),this.uuid=Ki(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let a=0,o=s.length;a<o;a++)s[a].isDataTexture?r.push(gr(s[a].image)):r.push(gr(s[a]))}else r=gr(s);n.url=r}return t||(e.images[this.uuid]=n),n}}function gr(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?Rh.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let Ph=0;class Rt extends $n{constructor(e=Rt.DEFAULT_IMAGE,t=Rt.DEFAULT_MAPPING,n=Wn,s=Wn,r=qt,a=Xn,o=Kt,l=pn,c=Rt.DEFAULT_ANISOTROPY,h=Tn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Ph++}),this.uuid=Ki(),this.name="",this.source=new Ql(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Ue(0,0),this.repeat=new Ue(1,1),this.center=new Ue(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ge,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==zl)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case ha:e.x=e.x-Math.floor(e.x);break;case Wn:e.x=e.x<0?0:1;break;case ua:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case ha:e.y=e.y-Math.floor(e.y);break;case Wn:e.y=e.y<0?0:1;break;case ua:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}Rt.DEFAULT_IMAGE=null;Rt.DEFAULT_MAPPING=zl;Rt.DEFAULT_ANISOTROPY=1;class ct{constructor(e=0,t=0,n=0,s=1){ct.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*s+a[12]*r,this.y=a[1]*t+a[5]*n+a[9]*s+a[13]*r,this.z=a[2]*t+a[6]*n+a[10]*s+a[14]*r,this.w=a[3]*t+a[7]*n+a[11]*s+a[15]*r,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r;const l=e.elements,c=l[0],h=l[4],m=l[8],p=l[1],u=l[5],_=l[9],M=l[2],f=l[6],d=l[10];if(Math.abs(h-p)<.01&&Math.abs(m-M)<.01&&Math.abs(_-f)<.01){if(Math.abs(h+p)<.1&&Math.abs(m+M)<.1&&Math.abs(_+f)<.1&&Math.abs(c+u+d-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const S=(c+1)/2,T=(u+1)/2,z=(d+1)/2,D=(h+p)/4,A=(m+M)/4,B=(_+f)/4;return S>T&&S>z?S<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(S),s=D/n,r=A/n):T>z?T<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(T),n=D/s,r=B/s):z<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(z),n=A/r,s=B/r),this.set(n,s,r,t),this}let E=Math.sqrt((f-_)*(f-_)+(m-M)*(m-M)+(p-h)*(p-h));return Math.abs(E)<.001&&(E=1),this.x=(f-_)/E,this.y=(m-M)/E,this.z=(p-h)/E,this.w=Math.acos((c+u+d-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Lh extends $n{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new ct(0,0,e,t),this.scissorTest=!1,this.viewport=new ct(0,0,e,t);const s={width:e,height:t,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:qt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const r=new Rt(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];const a=n.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,s=e.textures.length;n<s;n++)this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0;const t=Object.assign({},e.texture.image);return this.texture.source=new Ql(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class qn extends Lh{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class ec extends Rt{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=zt,this.minFilter=zt,this.wrapR=Wn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class Dh extends Rt{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=zt,this.minFilter=zt,this.wrapR=Wn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class jn{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,a,o){let l=n[s+0],c=n[s+1],h=n[s+2],m=n[s+3];const p=r[a+0],u=r[a+1],_=r[a+2],M=r[a+3];if(o===0){e[t+0]=l,e[t+1]=c,e[t+2]=h,e[t+3]=m;return}if(o===1){e[t+0]=p,e[t+1]=u,e[t+2]=_,e[t+3]=M;return}if(m!==M||l!==p||c!==u||h!==_){let f=1-o;const d=l*p+c*u+h*_+m*M,E=d>=0?1:-1,S=1-d*d;if(S>Number.EPSILON){const z=Math.sqrt(S),D=Math.atan2(z,d*E);f=Math.sin(f*D)/z,o=Math.sin(o*D)/z}const T=o*E;if(l=l*f+p*T,c=c*f+u*T,h=h*f+_*T,m=m*f+M*T,f===1-o){const z=1/Math.sqrt(l*l+c*c+h*h+m*m);l*=z,c*=z,h*=z,m*=z}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=m}static multiplyQuaternionsFlat(e,t,n,s,r,a){const o=n[s],l=n[s+1],c=n[s+2],h=n[s+3],m=r[a],p=r[a+1],u=r[a+2],_=r[a+3];return e[t]=o*_+h*m+l*u-c*p,e[t+1]=l*_+h*p+c*m-o*u,e[t+2]=c*_+h*u+o*p-l*m,e[t+3]=h*_-o*m-l*p-c*u,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,s=e._y,r=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(s/2),m=o(r/2),p=l(n/2),u=l(s/2),_=l(r/2);switch(a){case"XYZ":this._x=p*h*m+c*u*_,this._y=c*u*m-p*h*_,this._z=c*h*_+p*u*m,this._w=c*h*m-p*u*_;break;case"YXZ":this._x=p*h*m+c*u*_,this._y=c*u*m-p*h*_,this._z=c*h*_-p*u*m,this._w=c*h*m+p*u*_;break;case"ZXY":this._x=p*h*m-c*u*_,this._y=c*u*m+p*h*_,this._z=c*h*_+p*u*m,this._w=c*h*m-p*u*_;break;case"ZYX":this._x=p*h*m-c*u*_,this._y=c*u*m+p*h*_,this._z=c*h*_-p*u*m,this._w=c*h*m+p*u*_;break;case"YZX":this._x=p*h*m+c*u*_,this._y=c*u*m+p*h*_,this._z=c*h*_-p*u*m,this._w=c*h*m-p*u*_;break;case"XZY":this._x=p*h*m-c*u*_,this._y=c*u*m-p*h*_,this._z=c*h*_+p*u*m,this._w=c*h*m+p*u*_;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],s=t[4],r=t[8],a=t[1],o=t[5],l=t[9],c=t[2],h=t[6],m=t[10],p=n+o+m;if(p>0){const u=.5/Math.sqrt(p+1);this._w=.25/u,this._x=(h-l)*u,this._y=(r-c)*u,this._z=(a-s)*u}else if(n>o&&n>m){const u=2*Math.sqrt(1+n-o-m);this._w=(h-l)/u,this._x=.25*u,this._y=(s+a)/u,this._z=(r+c)/u}else if(o>m){const u=2*Math.sqrt(1+o-n-m);this._w=(r-c)/u,this._x=(s+a)/u,this._y=.25*u,this._z=(l+h)/u}else{const u=2*Math.sqrt(1+m-n-o);this._w=(a-s)/u,this._x=(r+c)/u,this._y=(l+h)/u,this._z=.25*u}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(bt(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,s=e._y,r=e._z,a=e._w,o=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+a*o+s*c-r*l,this._y=s*h+a*l+r*o-n*c,this._z=r*h+a*c+n*l-s*o,this._w=a*h-n*o-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,s=this._y,r=this._z,a=this._w;let o=a*e._w+n*e._x+s*e._y+r*e._z;if(o<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,o=-o):this.copy(e),o>=1)return this._w=a,this._x=n,this._y=s,this._z=r,this;const l=1-o*o;if(l<=Number.EPSILON){const u=1-t;return this._w=u*a+t*this._w,this._x=u*n+t*this._x,this._y=u*s+t*this._y,this._z=u*r+t*this._z,this.normalize(),this}const c=Math.sqrt(l),h=Math.atan2(c,o),m=Math.sin((1-t)*h)/c,p=Math.sin(t*h)/c;return this._w=a*m+this._w*p,this._x=n*m+this._x*p,this._y=s*m+this._y*p,this._z=r*m+this._z*p,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class O{constructor(e=0,t=0,n=0){O.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(bo.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(bo.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=e.elements,a=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*a,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*a,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*a,this}applyQuaternion(e){const t=this.x,n=this.y,s=this.z,r=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*s-o*n),h=2*(o*t-r*s),m=2*(r*n-a*t);return this.x=t+l*c+a*m-o*h,this.y=n+l*h+o*c-r*m,this.z=s+l*m+r*h-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,s=e.y,r=e.z,a=t.x,o=t.y,l=t.z;return this.x=s*l-r*o,this.y=r*a-n*l,this.z=n*o-s*a,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return vr.copy(this).projectOnVector(e),this.sub(vr)}reflect(e){return this.sub(vr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(bt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const vr=new O,bo=new jn;class $i{constructor(e=new O(1/0,1/0,1/0),t=new O(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(Wt.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(Wt.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=Wt.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,Wt):Wt.fromBufferAttribute(r,a),Wt.applyMatrix4(e.matrixWorld),this.expandByPoint(Wt);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),rs.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),rs.copy(n.boundingBox)),rs.applyMatrix4(e.matrixWorld),this.union(rs)}const s=e.children;for(let r=0,a=s.length;r<a;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Wt),Wt.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Fi),as.subVectors(this.max,Fi),ii.subVectors(e.a,Fi),si.subVectors(e.b,Fi),ri.subVectors(e.c,Fi),gn.subVectors(si,ii),vn.subVectors(ri,si),Nn.subVectors(ii,ri);let t=[0,-gn.z,gn.y,0,-vn.z,vn.y,0,-Nn.z,Nn.y,gn.z,0,-gn.x,vn.z,0,-vn.x,Nn.z,0,-Nn.x,-gn.y,gn.x,0,-vn.y,vn.x,0,-Nn.y,Nn.x,0];return!xr(t,ii,si,ri,as)||(t=[1,0,0,0,1,0,0,0,1],!xr(t,ii,si,ri,as))?!1:(os.crossVectors(gn,vn),t=[os.x,os.y,os.z],xr(t,ii,si,ri,as))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Wt).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Wt).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(sn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),sn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),sn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),sn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),sn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),sn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),sn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),sn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(sn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const sn=[new O,new O,new O,new O,new O,new O,new O,new O],Wt=new O,rs=new $i,ii=new O,si=new O,ri=new O,gn=new O,vn=new O,Nn=new O,Fi=new O,as=new O,os=new O,Un=new O;function xr(i,e,t,n,s){for(let r=0,a=i.length-3;r<=a;r+=3){Un.fromArray(i,r);const o=s.x*Math.abs(Un.x)+s.y*Math.abs(Un.y)+s.z*Math.abs(Un.z),l=e.dot(Un),c=t.dot(Un),h=n.dot(Un);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}const Ih=new $i,Oi=new O,Mr=new O;class tr{constructor(e=new O,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Ih.setFromPoints(e).getCenter(n);let s=0;for(let r=0,a=e.length;r<a;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Oi.subVectors(e,this.center);const t=Oi.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Oi,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Mr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Oi.copy(e.center).add(Mr)),this.expandByPoint(Oi.copy(e.center).sub(Mr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const rn=new O,Sr=new O,ls=new O,xn=new O,yr=new O,cs=new O,Er=new O;class nr{constructor(e=new O,t=new O(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,rn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=rn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(rn.copy(this.origin).addScaledVector(this.direction,t),rn.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){Sr.copy(e).add(t).multiplyScalar(.5),ls.copy(t).sub(e).normalize(),xn.copy(this.origin).sub(Sr);const r=e.distanceTo(t)*.5,a=-this.direction.dot(ls),o=xn.dot(this.direction),l=-xn.dot(ls),c=xn.lengthSq(),h=Math.abs(1-a*a);let m,p,u,_;if(h>0)if(m=a*l-o,p=a*o-l,_=r*h,m>=0)if(p>=-_)if(p<=_){const M=1/h;m*=M,p*=M,u=m*(m+a*p+2*o)+p*(a*m+p+2*l)+c}else p=r,m=Math.max(0,-(a*p+o)),u=-m*m+p*(p+2*l)+c;else p=-r,m=Math.max(0,-(a*p+o)),u=-m*m+p*(p+2*l)+c;else p<=-_?(m=Math.max(0,-(-a*r+o)),p=m>0?-r:Math.min(Math.max(-r,-l),r),u=-m*m+p*(p+2*l)+c):p<=_?(m=0,p=Math.min(Math.max(-r,-l),r),u=p*(p+2*l)+c):(m=Math.max(0,-(a*r+o)),p=m>0?r:Math.min(Math.max(-r,-l),r),u=-m*m+p*(p+2*l)+c);else p=a>0?-r:r,m=Math.max(0,-(a*p+o)),u=-m*m+p*(p+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,m),s&&s.copy(Sr).addScaledVector(ls,p),u}intersectSphere(e,t){rn.subVectors(e.center,this.origin);const n=rn.dot(this.direction),s=rn.dot(rn)-n*n,r=e.radius*e.radius;if(s>r)return null;const a=Math.sqrt(r-s),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,t):this.at(o,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,a,o,l;const c=1/this.direction.x,h=1/this.direction.y,m=1/this.direction.z,p=this.origin;return c>=0?(n=(e.min.x-p.x)*c,s=(e.max.x-p.x)*c):(n=(e.max.x-p.x)*c,s=(e.min.x-p.x)*c),h>=0?(r=(e.min.y-p.y)*h,a=(e.max.y-p.y)*h):(r=(e.max.y-p.y)*h,a=(e.min.y-p.y)*h),n>a||r>s||((r>n||isNaN(n))&&(n=r),(a<s||isNaN(s))&&(s=a),m>=0?(o=(e.min.z-p.z)*m,l=(e.max.z-p.z)*m):(o=(e.max.z-p.z)*m,l=(e.min.z-p.z)*m),n>l||o>s)||((o>n||n!==n)&&(n=o),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,rn)!==null}intersectTriangle(e,t,n,s,r){yr.subVectors(t,e),cs.subVectors(n,e),Er.crossVectors(yr,cs);let a=this.direction.dot(Er),o;if(a>0){if(s)return null;o=1}else if(a<0)o=-1,a=-a;else return null;xn.subVectors(this.origin,e);const l=o*this.direction.dot(cs.crossVectors(xn,cs));if(l<0)return null;const c=o*this.direction.dot(yr.cross(xn));if(c<0||l+c>a)return null;const h=-o*xn.dot(Er);return h<0?null:this.at(h/a,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class st{constructor(e,t,n,s,r,a,o,l,c,h,m,p,u,_,M,f){st.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c,h,m,p,u,_,M,f)}set(e,t,n,s,r,a,o,l,c,h,m,p,u,_,M,f){const d=this.elements;return d[0]=e,d[4]=t,d[8]=n,d[12]=s,d[1]=r,d[5]=a,d[9]=o,d[13]=l,d[2]=c,d[6]=h,d[10]=m,d[14]=p,d[3]=u,d[7]=_,d[11]=M,d[15]=f,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new st().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,s=1/ai.setFromMatrixColumn(e,0).length(),r=1/ai.setFromMatrixColumn(e,1).length(),a=1/ai.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,s=e.y,r=e.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(s),c=Math.sin(s),h=Math.cos(r),m=Math.sin(r);if(e.order==="XYZ"){const p=a*h,u=a*m,_=o*h,M=o*m;t[0]=l*h,t[4]=-l*m,t[8]=c,t[1]=u+_*c,t[5]=p-M*c,t[9]=-o*l,t[2]=M-p*c,t[6]=_+u*c,t[10]=a*l}else if(e.order==="YXZ"){const p=l*h,u=l*m,_=c*h,M=c*m;t[0]=p+M*o,t[4]=_*o-u,t[8]=a*c,t[1]=a*m,t[5]=a*h,t[9]=-o,t[2]=u*o-_,t[6]=M+p*o,t[10]=a*l}else if(e.order==="ZXY"){const p=l*h,u=l*m,_=c*h,M=c*m;t[0]=p-M*o,t[4]=-a*m,t[8]=_+u*o,t[1]=u+_*o,t[5]=a*h,t[9]=M-p*o,t[2]=-a*c,t[6]=o,t[10]=a*l}else if(e.order==="ZYX"){const p=a*h,u=a*m,_=o*h,M=o*m;t[0]=l*h,t[4]=_*c-u,t[8]=p*c+M,t[1]=l*m,t[5]=M*c+p,t[9]=u*c-_,t[2]=-c,t[6]=o*l,t[10]=a*l}else if(e.order==="YZX"){const p=a*l,u=a*c,_=o*l,M=o*c;t[0]=l*h,t[4]=M-p*m,t[8]=_*m+u,t[1]=m,t[5]=a*h,t[9]=-o*h,t[2]=-c*h,t[6]=u*m+_,t[10]=p-M*m}else if(e.order==="XZY"){const p=a*l,u=a*c,_=o*l,M=o*c;t[0]=l*h,t[4]=-m,t[8]=c*h,t[1]=p*m+M,t[5]=a*h,t[9]=u*m-_,t[2]=_*m-u,t[6]=o*h,t[10]=M*m+p}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Nh,e,Uh)}lookAt(e,t,n){const s=this.elements;return Dt.subVectors(e,t),Dt.lengthSq()===0&&(Dt.z=1),Dt.normalize(),Mn.crossVectors(n,Dt),Mn.lengthSq()===0&&(Math.abs(n.z)===1?Dt.x+=1e-4:Dt.z+=1e-4,Dt.normalize(),Mn.crossVectors(n,Dt)),Mn.normalize(),hs.crossVectors(Dt,Mn),s[0]=Mn.x,s[4]=hs.x,s[8]=Dt.x,s[1]=Mn.y,s[5]=hs.y,s[9]=Dt.y,s[2]=Mn.z,s[6]=hs.z,s[10]=Dt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],m=n[5],p=n[9],u=n[13],_=n[2],M=n[6],f=n[10],d=n[14],E=n[3],S=n[7],T=n[11],z=n[15],D=s[0],A=s[4],B=s[8],ie=s[12],g=s[1],y=s[5],W=s[9],H=s[13],Q=s[2],re=s[6],Y=s[10],ne=s[14],V=s[3],ve=s[7],Me=s[11],ye=s[15];return r[0]=a*D+o*g+l*Q+c*V,r[4]=a*A+o*y+l*re+c*ve,r[8]=a*B+o*W+l*Y+c*Me,r[12]=a*ie+o*H+l*ne+c*ye,r[1]=h*D+m*g+p*Q+u*V,r[5]=h*A+m*y+p*re+u*ve,r[9]=h*B+m*W+p*Y+u*Me,r[13]=h*ie+m*H+p*ne+u*ye,r[2]=_*D+M*g+f*Q+d*V,r[6]=_*A+M*y+f*re+d*ve,r[10]=_*B+M*W+f*Y+d*Me,r[14]=_*ie+M*H+f*ne+d*ye,r[3]=E*D+S*g+T*Q+z*V,r[7]=E*A+S*y+T*re+z*ve,r[11]=E*B+S*W+T*Y+z*Me,r[15]=E*ie+S*H+T*ne+z*ye,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],a=e[1],o=e[5],l=e[9],c=e[13],h=e[2],m=e[6],p=e[10],u=e[14],_=e[3],M=e[7],f=e[11],d=e[15];return _*(+r*l*m-s*c*m-r*o*p+n*c*p+s*o*u-n*l*u)+M*(+t*l*u-t*c*p+r*a*p-s*a*u+s*c*h-r*l*h)+f*(+t*c*m-t*o*u-r*a*m+n*a*u+r*o*h-n*c*h)+d*(-s*o*h-t*l*m+t*o*p+s*a*m-n*a*p+n*l*h)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],m=e[9],p=e[10],u=e[11],_=e[12],M=e[13],f=e[14],d=e[15],E=m*f*c-M*p*c+M*l*u-o*f*u-m*l*d+o*p*d,S=_*p*c-h*f*c-_*l*u+a*f*u+h*l*d-a*p*d,T=h*M*c-_*m*c+_*o*u-a*M*u-h*o*d+a*m*d,z=_*m*l-h*M*l-_*o*p+a*M*p+h*o*f-a*m*f,D=t*E+n*S+s*T+r*z;if(D===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const A=1/D;return e[0]=E*A,e[1]=(M*p*r-m*f*r-M*s*u+n*f*u+m*s*d-n*p*d)*A,e[2]=(o*f*r-M*l*r+M*s*c-n*f*c-o*s*d+n*l*d)*A,e[3]=(m*l*r-o*p*r-m*s*c+n*p*c+o*s*u-n*l*u)*A,e[4]=S*A,e[5]=(h*f*r-_*p*r+_*s*u-t*f*u-h*s*d+t*p*d)*A,e[6]=(_*l*r-a*f*r-_*s*c+t*f*c+a*s*d-t*l*d)*A,e[7]=(a*p*r-h*l*r+h*s*c-t*p*c-a*s*u+t*l*u)*A,e[8]=T*A,e[9]=(_*m*r-h*M*r-_*n*u+t*M*u+h*n*d-t*m*d)*A,e[10]=(a*M*r-_*o*r+_*n*c-t*M*c-a*n*d+t*o*d)*A,e[11]=(h*o*r-a*m*r-h*n*c+t*m*c+a*n*u-t*o*u)*A,e[12]=z*A,e[13]=(h*M*s-_*m*s+_*n*p-t*M*p-h*n*f+t*m*f)*A,e[14]=(_*o*s-a*M*s-_*n*l+t*M*l+a*n*f-t*o*f)*A,e[15]=(a*m*s-h*o*s+h*n*l-t*m*l-a*n*p+t*o*p)*A,this}scale(e){const t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),s=Math.sin(t),r=1-n,a=e.x,o=e.y,l=e.z,c=r*a,h=r*o;return this.set(c*a+n,c*o-s*l,c*l+s*o,0,c*o+s*l,h*o+n,h*l-s*a,0,c*l-s*o,h*l+s*a,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,a){return this.set(1,n,r,0,e,1,a,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){const s=this.elements,r=t._x,a=t._y,o=t._z,l=t._w,c=r+r,h=a+a,m=o+o,p=r*c,u=r*h,_=r*m,M=a*h,f=a*m,d=o*m,E=l*c,S=l*h,T=l*m,z=n.x,D=n.y,A=n.z;return s[0]=(1-(M+d))*z,s[1]=(u+T)*z,s[2]=(_-S)*z,s[3]=0,s[4]=(u-T)*D,s[5]=(1-(p+d))*D,s[6]=(f+E)*D,s[7]=0,s[8]=(_+S)*A,s[9]=(f-E)*A,s[10]=(1-(p+M))*A,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){const s=this.elements;let r=ai.set(s[0],s[1],s[2]).length();const a=ai.set(s[4],s[5],s[6]).length(),o=ai.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],Xt.copy(this);const c=1/r,h=1/a,m=1/o;return Xt.elements[0]*=c,Xt.elements[1]*=c,Xt.elements[2]*=c,Xt.elements[4]*=h,Xt.elements[5]*=h,Xt.elements[6]*=h,Xt.elements[8]*=m,Xt.elements[9]*=m,Xt.elements[10]*=m,t.setFromRotationMatrix(Xt),n.x=r,n.y=a,n.z=o,this}makePerspective(e,t,n,s,r,a,o=dn){const l=this.elements,c=2*r/(t-e),h=2*r/(n-s),m=(t+e)/(t-e),p=(n+s)/(n-s);let u,_;if(o===dn)u=-(a+r)/(a-r),_=-2*a*r/(a-r);else if(o===Ws)u=-a/(a-r),_=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return l[0]=c,l[4]=0,l[8]=m,l[12]=0,l[1]=0,l[5]=h,l[9]=p,l[13]=0,l[2]=0,l[6]=0,l[10]=u,l[14]=_,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,a,o=dn){const l=this.elements,c=1/(t-e),h=1/(n-s),m=1/(a-r),p=(t+e)*c,u=(n+s)*h;let _,M;if(o===dn)_=(a+r)*m,M=-2*m;else if(o===Ws)_=r*m,M=-1*m;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-p,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-u,l[2]=0,l[6]=0,l[10]=M,l[14]=-_,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const ai=new O,Xt=new st,Nh=new O(0,0,0),Uh=new O(1,1,1),Mn=new O,hs=new O,Dt=new O,To=new st,Ao=new jn;class tn{constructor(e=0,t=0,n=0,s=tn.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const s=e.elements,r=s[0],a=s[4],o=s[8],l=s[1],c=s[5],h=s[9],m=s[2],p=s[6],u=s[10];switch(t){case"XYZ":this._y=Math.asin(bt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,u),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(p,c),this._z=0);break;case"YXZ":this._x=Math.asin(-bt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,u),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-m,r),this._z=0);break;case"ZXY":this._x=Math.asin(bt(p,-1,1)),Math.abs(p)<.9999999?(this._y=Math.atan2(-m,u),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-bt(m,-1,1)),Math.abs(m)<.9999999?(this._x=Math.atan2(p,u),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(bt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-m,r)):(this._x=0,this._y=Math.atan2(o,u));break;case"XZY":this._z=Math.asin(-bt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(p,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-h,u),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return To.makeRotationFromQuaternion(e),this.setFromRotationMatrix(To,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Ao.setFromEuler(this),this.setFromQuaternion(Ao,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}tn.DEFAULT_ORDER="XYZ";class Za{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let Fh=0;const wo=new O,oi=new jn,an=new st,us=new O,Bi=new O,Oh=new O,Bh=new jn,Ro=new O(1,0,0),Co=new O(0,1,0),Po=new O(0,0,1),Lo={type:"added"},zh={type:"removed"},li={type:"childadded",child:null},br={type:"childremoved",child:null};class gt extends $n{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Fh++}),this.uuid=Ki(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=gt.DEFAULT_UP.clone();const e=new O,t=new tn,n=new jn,s=new O(1,1,1);function r(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new st},normalMatrix:{value:new Ge}}),this.matrix=new st,this.matrixWorld=new st,this.matrixAutoUpdate=gt.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=gt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Za,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return oi.setFromAxisAngle(e,t),this.quaternion.multiply(oi),this}rotateOnWorldAxis(e,t){return oi.setFromAxisAngle(e,t),this.quaternion.premultiply(oi),this}rotateX(e){return this.rotateOnAxis(Ro,e)}rotateY(e){return this.rotateOnAxis(Co,e)}rotateZ(e){return this.rotateOnAxis(Po,e)}translateOnAxis(e,t){return wo.copy(e).applyQuaternion(this.quaternion),this.position.add(wo.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Ro,e)}translateY(e){return this.translateOnAxis(Co,e)}translateZ(e){return this.translateOnAxis(Po,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(an.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?us.copy(e):us.set(e,t,n);const s=this.parent;this.updateWorldMatrix(!0,!1),Bi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?an.lookAt(Bi,us,this.up):an.lookAt(us,Bi,this.up),this.quaternion.setFromRotationMatrix(an),s&&(an.extractRotation(s.matrixWorld),oi.setFromRotationMatrix(an),this.quaternion.premultiply(oi.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Lo),li.child=e,this.dispatchEvent(li),li.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(zh),br.child=e,this.dispatchEvent(br),br.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),an.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),an.multiply(e.parent.matrixWorld)),e.applyMatrix4(an),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Lo),li.child=e,this.dispatchEvent(li),li.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){const a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Bi,e,Oh),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Bi,Bh,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(o=>({boxInitialized:o.boxInitialized,boxMin:o.box.min.toArray(),boxMax:o.box.max.toArray(),sphereInitialized:o.sphereInitialized,sphereRadius:o.sphere.radius,sphereCenter:o.sphere.center.toArray()})),s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){const m=l[c];r(e.shapes,m)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(e.materials,this.material[l]));s.material=o}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let o=0;o<this.children.length;o++)s.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];s.animations.push(r(e.animations,l))}}if(t){const o=a(e.geometries),l=a(e.materials),c=a(e.textures),h=a(e.images),m=a(e.shapes),p=a(e.skeletons),u=a(e.animations),_=a(e.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),m.length>0&&(n.shapes=m),p.length>0&&(n.skeletons=p),u.length>0&&(n.animations=u),_.length>0&&(n.nodes=_)}return n.object=s,n;function a(o){const l=[];for(const c in o){const h=o[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const s=e.children[n];this.add(s.clone())}return this}}gt.DEFAULT_UP=new O(0,1,0);gt.DEFAULT_MATRIX_AUTO_UPDATE=!0;gt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Yt=new O,on=new O,Tr=new O,ln=new O,ci=new O,hi=new O,Do=new O,Ar=new O,wr=new O,Rr=new O,Cr=new ct,Pr=new ct,Lr=new ct;class jt{constructor(e=new O,t=new O,n=new O){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),Yt.subVectors(e,t),s.cross(Yt);const r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){Yt.subVectors(s,t),on.subVectors(n,t),Tr.subVectors(e,t);const a=Yt.dot(Yt),o=Yt.dot(on),l=Yt.dot(Tr),c=on.dot(on),h=on.dot(Tr),m=a*c-o*o;if(m===0)return r.set(0,0,0),null;const p=1/m,u=(c*l-o*h)*p,_=(a*h-o*l)*p;return r.set(1-u-_,_,u)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,ln)===null?!1:ln.x>=0&&ln.y>=0&&ln.x+ln.y<=1}static getInterpolation(e,t,n,s,r,a,o,l){return this.getBarycoord(e,t,n,s,ln)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,ln.x),l.addScaledVector(a,ln.y),l.addScaledVector(o,ln.z),l)}static getInterpolatedAttribute(e,t,n,s,r,a){return Cr.setScalar(0),Pr.setScalar(0),Lr.setScalar(0),Cr.fromBufferAttribute(e,t),Pr.fromBufferAttribute(e,n),Lr.fromBufferAttribute(e,s),a.setScalar(0),a.addScaledVector(Cr,r.x),a.addScaledVector(Pr,r.y),a.addScaledVector(Lr,r.z),a}static isFrontFacing(e,t,n,s){return Yt.subVectors(n,t),on.subVectors(e,t),Yt.cross(on).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Yt.subVectors(this.c,this.b),on.subVectors(this.a,this.b),Yt.cross(on).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return jt.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return jt.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return jt.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return jt.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return jt.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,s=this.b,r=this.c;let a,o;ci.subVectors(s,n),hi.subVectors(r,n),Ar.subVectors(e,n);const l=ci.dot(Ar),c=hi.dot(Ar);if(l<=0&&c<=0)return t.copy(n);wr.subVectors(e,s);const h=ci.dot(wr),m=hi.dot(wr);if(h>=0&&m<=h)return t.copy(s);const p=l*m-h*c;if(p<=0&&l>=0&&h<=0)return a=l/(l-h),t.copy(n).addScaledVector(ci,a);Rr.subVectors(e,r);const u=ci.dot(Rr),_=hi.dot(Rr);if(_>=0&&u<=_)return t.copy(r);const M=u*c-l*_;if(M<=0&&c>=0&&_<=0)return o=c/(c-_),t.copy(n).addScaledVector(hi,o);const f=h*_-u*m;if(f<=0&&m-h>=0&&u-_>=0)return Do.subVectors(r,s),o=(m-h)/(m-h+(u-_)),t.copy(s).addScaledVector(Do,o);const d=1/(f+M+p);return a=M*d,o=p*d,t.copy(n).addScaledVector(ci,a).addScaledVector(hi,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const tc={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Sn={h:0,s:0,l:0},ds={h:0,s:0,l:0};function Dr(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}class Ye{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Zt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,et.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=et.workingColorSpace){return this.r=e,this.g=t,this.b=n,et.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=et.workingColorSpace){if(e=Sh(e,1),t=bt(t,0,1),n=bt(n,0,1),t===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+t):n+t-n*t,a=2*n-r;this.r=Dr(a,r,e+1/3),this.g=Dr(a,r,e),this.b=Dr(a,r,e-1/3)}return et.toWorkingColorSpace(this,s),this}setStyle(e,t=Zt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r;const a=s[1],o=s[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){const r=s[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Zt){const n=tc[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Si(e.r),this.g=Si(e.g),this.b=Si(e.b),this}copyLinearToSRGB(e){return this.r=_r(e.r),this.g=_r(e.g),this.b=_r(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Zt){return et.fromWorkingColorSpace(yt.copy(this),e),Math.round(bt(yt.r*255,0,255))*65536+Math.round(bt(yt.g*255,0,255))*256+Math.round(bt(yt.b*255,0,255))}getHexString(e=Zt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=et.workingColorSpace){et.fromWorkingColorSpace(yt.copy(this),t);const n=yt.r,s=yt.g,r=yt.b,a=Math.max(n,s,r),o=Math.min(n,s,r);let l,c;const h=(o+a)/2;if(o===a)l=0,c=0;else{const m=a-o;switch(c=h<=.5?m/(a+o):m/(2-a-o),a){case n:l=(s-r)/m+(s<r?6:0);break;case s:l=(r-n)/m+2;break;case r:l=(n-s)/m+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=et.workingColorSpace){return et.fromWorkingColorSpace(yt.copy(this),t),e.r=yt.r,e.g=yt.g,e.b=yt.b,e}getStyle(e=Zt){et.fromWorkingColorSpace(yt.copy(this),e);const t=yt.r,n=yt.g,s=yt.b;return e!==Zt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Sn),this.setHSL(Sn.h+e,Sn.s+t,Sn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Sn),e.getHSL(ds);const n=pr(Sn.h,ds.h,t),s=pr(Sn.s,ds.s,t),r=pr(Sn.l,ds.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const yt=new Ye;Ye.NAMES=tc;let kh=0;class Zn extends $n{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:kh++}),this.uuid=Ki(),this.name="",this.type="Material",this.blending=xi,this.side=Ln,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Qr,this.blendDst=ea,this.blendEquation=Gn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ye(0,0,0),this.blendAlpha=0,this.depthFunc=bi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=vo,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ti,this.stencilZFail=ti,this.stencilZPass=ti,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==xi&&(n.blending=this.blending),this.side!==Ln&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Qr&&(n.blendSrc=this.blendSrc),this.blendDst!==ea&&(n.blendDst=this.blendDst),this.blendEquation!==Gn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==bi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==vo&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ti&&(n.stencilFail=this.stencilFail),this.stencilZFail!==ti&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==ti&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){const a=[];for(const o in r){const l=r[o];delete l.metadata,a.push(l)}return a}if(t){const r=s(e.textures),a=s(e.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class Ja extends Zn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ye(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new tn,this.combine=Bl,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const ut=new O,fs=new Ue;class en{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=xo,this.updateRanges=[],this.gpuType=un,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)fs.fromBufferAttribute(this,t),fs.applyMatrix3(e),this.setXY(t,fs.x,fs.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.applyMatrix3(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.applyMatrix4(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.applyNormalMatrix(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.transformDirection(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Ni(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Tt(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Ni(t,this.array)),t}setX(e,t){return this.normalized&&(t=Tt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Ni(t,this.array)),t}setY(e,t){return this.normalized&&(t=Tt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Ni(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Tt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Ni(t,this.array)),t}setW(e,t){return this.normalized&&(t=Tt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Tt(t,this.array),n=Tt(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=Tt(t,this.array),n=Tt(n,this.array),s=Tt(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=Tt(t,this.array),n=Tt(n,this.array),s=Tt(s,this.array),r=Tt(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==xo&&(e.usage=this.usage),e}}class nc extends en{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class ic extends en{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class Ct extends en{constructor(e,t,n){super(new Float32Array(e),t,n)}}let Hh=0;const Ot=new st,Ir=new gt,ui=new O,It=new $i,zi=new $i,_t=new O;class Ut extends $n{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Hh++}),this.uuid=Ki(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Jl(e)?ic:nc)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Ge().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}const s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Ot.makeRotationFromQuaternion(e),this.applyMatrix4(Ot),this}rotateX(e){return Ot.makeRotationX(e),this.applyMatrix4(Ot),this}rotateY(e){return Ot.makeRotationY(e),this.applyMatrix4(Ot),this}rotateZ(e){return Ot.makeRotationZ(e),this.applyMatrix4(Ot),this}translate(e,t,n){return Ot.makeTranslation(e,t,n),this.applyMatrix4(Ot),this}scale(e,t,n){return Ot.makeScale(e,t,n),this.applyMatrix4(Ot),this}lookAt(e){return Ir.lookAt(e),Ir.updateMatrix(),this.applyMatrix4(Ir.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ui).negate(),this.translate(ui.x,ui.y,ui.z),this}setFromPoints(e){const t=[];for(let n=0,s=e.length;n<s;n++){const r=e[n];t.push(r.x,r.y,r.z||0)}return this.setAttribute("position",new Ct(t,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new $i);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new O(-1/0,-1/0,-1/0),new O(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){const r=t[n];It.setFromBufferAttribute(r),this.morphTargetsRelative?(_t.addVectors(this.boundingBox.min,It.min),this.boundingBox.expandByPoint(_t),_t.addVectors(this.boundingBox.max,It.max),this.boundingBox.expandByPoint(_t)):(this.boundingBox.expandByPoint(It.min),this.boundingBox.expandByPoint(It.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new tr);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new O,1/0);return}if(e){const n=this.boundingSphere.center;if(It.setFromBufferAttribute(e),t)for(let r=0,a=t.length;r<a;r++){const o=t[r];zi.setFromBufferAttribute(o),this.morphTargetsRelative?(_t.addVectors(It.min,zi.min),It.expandByPoint(_t),_t.addVectors(It.max,zi.max),It.expandByPoint(_t)):(It.expandByPoint(zi.min),It.expandByPoint(zi.max))}It.getCenter(n);let s=0;for(let r=0,a=e.count;r<a;r++)_t.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(_t));if(t)for(let r=0,a=t.length;r<a;r++){const o=t[r],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)_t.fromBufferAttribute(o,c),l&&(ui.fromBufferAttribute(e,c),_t.add(ui)),s=Math.max(s,n.distanceToSquared(_t))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=t.position,s=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new en(new Float32Array(4*n.count),4));const a=this.getAttribute("tangent"),o=[],l=[];for(let B=0;B<n.count;B++)o[B]=new O,l[B]=new O;const c=new O,h=new O,m=new O,p=new Ue,u=new Ue,_=new Ue,M=new O,f=new O;function d(B,ie,g){c.fromBufferAttribute(n,B),h.fromBufferAttribute(n,ie),m.fromBufferAttribute(n,g),p.fromBufferAttribute(r,B),u.fromBufferAttribute(r,ie),_.fromBufferAttribute(r,g),h.sub(c),m.sub(c),u.sub(p),_.sub(p);const y=1/(u.x*_.y-_.x*u.y);isFinite(y)&&(M.copy(h).multiplyScalar(_.y).addScaledVector(m,-u.y).multiplyScalar(y),f.copy(m).multiplyScalar(u.x).addScaledVector(h,-_.x).multiplyScalar(y),o[B].add(M),o[ie].add(M),o[g].add(M),l[B].add(f),l[ie].add(f),l[g].add(f))}let E=this.groups;E.length===0&&(E=[{start:0,count:e.count}]);for(let B=0,ie=E.length;B<ie;++B){const g=E[B],y=g.start,W=g.count;for(let H=y,Q=y+W;H<Q;H+=3)d(e.getX(H+0),e.getX(H+1),e.getX(H+2))}const S=new O,T=new O,z=new O,D=new O;function A(B){z.fromBufferAttribute(s,B),D.copy(z);const ie=o[B];S.copy(ie),S.sub(z.multiplyScalar(z.dot(ie))).normalize(),T.crossVectors(D,ie);const y=T.dot(l[B])<0?-1:1;a.setXYZW(B,S.x,S.y,S.z,y)}for(let B=0,ie=E.length;B<ie;++B){const g=E[B],y=g.start,W=g.count;for(let H=y,Q=y+W;H<Q;H+=3)A(e.getX(H+0)),A(e.getX(H+1)),A(e.getX(H+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new en(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let p=0,u=n.count;p<u;p++)n.setXYZ(p,0,0,0);const s=new O,r=new O,a=new O,o=new O,l=new O,c=new O,h=new O,m=new O;if(e)for(let p=0,u=e.count;p<u;p+=3){const _=e.getX(p+0),M=e.getX(p+1),f=e.getX(p+2);s.fromBufferAttribute(t,_),r.fromBufferAttribute(t,M),a.fromBufferAttribute(t,f),h.subVectors(a,r),m.subVectors(s,r),h.cross(m),o.fromBufferAttribute(n,_),l.fromBufferAttribute(n,M),c.fromBufferAttribute(n,f),o.add(h),l.add(h),c.add(h),n.setXYZ(_,o.x,o.y,o.z),n.setXYZ(M,l.x,l.y,l.z),n.setXYZ(f,c.x,c.y,c.z)}else for(let p=0,u=t.count;p<u;p+=3)s.fromBufferAttribute(t,p+0),r.fromBufferAttribute(t,p+1),a.fromBufferAttribute(t,p+2),h.subVectors(a,r),m.subVectors(s,r),h.cross(m),n.setXYZ(p+0,h.x,h.y,h.z),n.setXYZ(p+1,h.x,h.y,h.z),n.setXYZ(p+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)_t.fromBufferAttribute(e,t),_t.normalize(),e.setXYZ(t,_t.x,_t.y,_t.z)}toNonIndexed(){function e(o,l){const c=o.array,h=o.itemSize,m=o.normalized,p=new c.constructor(l.length*h);let u=0,_=0;for(let M=0,f=l.length;M<f;M++){o.isInterleavedBufferAttribute?u=l[M]*o.data.stride+o.offset:u=l[M]*h;for(let d=0;d<h;d++)p[_++]=c[u++]}return new en(p,h,m)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new Ut,n=this.index.array,s=this.attributes;for(const o in s){const l=s[o],c=e(l,n);t.setAttribute(o,c)}const r=this.morphAttributes;for(const o in r){const l=[],c=r[o];for(let h=0,m=c.length;h<m;h++){const p=c[h],u=e(p,n);l.push(u)}t.morphAttributes[o]=l}t.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const c=a[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const l in n){const c=n[l];e.data.attributes[l]=c.toJSON(e.data)}const s={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],h=[];for(let m=0,p=c.length;m<p;m++){const u=c[m];h.push(u.toJSON(e.data))}h.length>0&&(s[l]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(e.data.boundingSphere={center:o.center.toArray(),radius:o.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone(t));const s=e.attributes;for(const c in s){const h=s[c];this.setAttribute(c,h.clone(t))}const r=e.morphAttributes;for(const c in r){const h=[],m=r[c];for(let p=0,u=m.length;p<u;p++)h.push(m[p].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;const a=e.groups;for(let c=0,h=a.length;c<h;c++){const m=a[c];this.addGroup(m.start,m.count,m.materialIndex)}const o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Io=new st,Fn=new nr,ps=new tr,No=new O,ms=new O,_s=new O,gs=new O,Nr=new O,vs=new O,Uo=new O,xs=new O;class kt extends gt{constructor(e=new Ut,t=new Ja){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){const o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(e,t){const n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(s,e);const o=this.morphTargetInfluences;if(r&&o){vs.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const h=o[l],m=r[l];h!==0&&(Nr.fromBufferAttribute(m,e),a?vs.addScaledVector(Nr,h):vs.addScaledVector(Nr.sub(t),h))}t.add(vs)}return t}raycast(e,t){const n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),ps.copy(n.boundingSphere),ps.applyMatrix4(r),Fn.copy(e.ray).recast(e.near),!(ps.containsPoint(Fn.origin)===!1&&(Fn.intersectSphere(ps,No)===null||Fn.origin.distanceToSquared(No)>(e.far-e.near)**2))&&(Io.copy(r).invert(),Fn.copy(e.ray).applyMatrix4(Io),!(n.boundingBox!==null&&Fn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Fn)))}_computeIntersections(e,t,n){let s;const r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,m=r.attributes.normal,p=r.groups,u=r.drawRange;if(o!==null)if(Array.isArray(a))for(let _=0,M=p.length;_<M;_++){const f=p[_],d=a[f.materialIndex],E=Math.max(f.start,u.start),S=Math.min(o.count,Math.min(f.start+f.count,u.start+u.count));for(let T=E,z=S;T<z;T+=3){const D=o.getX(T),A=o.getX(T+1),B=o.getX(T+2);s=Ms(this,d,e,n,c,h,m,D,A,B),s&&(s.faceIndex=Math.floor(T/3),s.face.materialIndex=f.materialIndex,t.push(s))}}else{const _=Math.max(0,u.start),M=Math.min(o.count,u.start+u.count);for(let f=_,d=M;f<d;f+=3){const E=o.getX(f),S=o.getX(f+1),T=o.getX(f+2);s=Ms(this,a,e,n,c,h,m,E,S,T),s&&(s.faceIndex=Math.floor(f/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(a))for(let _=0,M=p.length;_<M;_++){const f=p[_],d=a[f.materialIndex],E=Math.max(f.start,u.start),S=Math.min(l.count,Math.min(f.start+f.count,u.start+u.count));for(let T=E,z=S;T<z;T+=3){const D=T,A=T+1,B=T+2;s=Ms(this,d,e,n,c,h,m,D,A,B),s&&(s.faceIndex=Math.floor(T/3),s.face.materialIndex=f.materialIndex,t.push(s))}}else{const _=Math.max(0,u.start),M=Math.min(l.count,u.start+u.count);for(let f=_,d=M;f<d;f+=3){const E=f,S=f+1,T=f+2;s=Ms(this,a,e,n,c,h,m,E,S,T),s&&(s.faceIndex=Math.floor(f/3),t.push(s))}}}}function Gh(i,e,t,n,s,r,a,o){let l;if(e.side===wt?l=n.intersectTriangle(a,r,s,!0,o):l=n.intersectTriangle(s,r,a,e.side===Ln,o),l===null)return null;xs.copy(o),xs.applyMatrix4(i.matrixWorld);const c=t.ray.origin.distanceTo(xs);return c<t.near||c>t.far?null:{distance:c,point:xs.clone(),object:i}}function Ms(i,e,t,n,s,r,a,o,l,c){i.getVertexPosition(o,ms),i.getVertexPosition(l,_s),i.getVertexPosition(c,gs);const h=Gh(i,e,t,n,ms,_s,gs,Uo);if(h){const m=new O;jt.getBarycoord(Uo,ms,_s,gs,m),s&&(h.uv=jt.getInterpolatedAttribute(s,o,l,c,m,new Ue)),r&&(h.uv1=jt.getInterpolatedAttribute(r,o,l,c,m,new Ue)),a&&(h.normal=jt.getInterpolatedAttribute(a,o,l,c,m,new O),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const p={a:o,b:l,c,normal:new O,materialIndex:0};jt.getNormal(ms,_s,gs,p.normal),h.face=p,h.barycoord=m}return h}class Zi extends Ut{constructor(e=1,t=1,n=1,s=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:a};const o=this;s=Math.floor(s),r=Math.floor(r),a=Math.floor(a);const l=[],c=[],h=[],m=[];let p=0,u=0;_("z","y","x",-1,-1,n,t,e,a,r,0),_("z","y","x",1,-1,n,t,-e,a,r,1),_("x","z","y",1,1,e,n,t,s,a,2),_("x","z","y",1,-1,e,n,-t,s,a,3),_("x","y","z",1,-1,e,t,n,s,r,4),_("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new Ct(c,3)),this.setAttribute("normal",new Ct(h,3)),this.setAttribute("uv",new Ct(m,2));function _(M,f,d,E,S,T,z,D,A,B,ie){const g=T/A,y=z/B,W=T/2,H=z/2,Q=D/2,re=A+1,Y=B+1;let ne=0,V=0;const ve=new O;for(let Me=0;Me<Y;Me++){const ye=Me*y-H;for(let ze=0;ze<re;ze++){const Be=ze*g-W;ve[M]=Be*E,ve[f]=ye*S,ve[d]=Q,c.push(ve.x,ve.y,ve.z),ve[M]=0,ve[f]=0,ve[d]=D>0?1:-1,h.push(ve.x,ve.y,ve.z),m.push(ze/A),m.push(1-Me/B),ne+=1}}for(let Me=0;Me<B;Me++)for(let ye=0;ye<A;ye++){const ze=p+ye+re*Me,Be=p+ye+re*(Me+1),j=p+(ye+1)+re*(Me+1),ae=p+(ye+1)+re*Me;l.push(ze,Be,ae),l.push(Be,j,ae),V+=6}o.addGroup(u,V,ie),u+=V,p+=ne}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Zi(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Ci(i){const e={};for(const t in i){e[t]={};for(const n in i[t]){const s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function Et(i){const e={};for(let t=0;t<i.length;t++){const n=Ci(i[t]);for(const s in n)e[s]=n[s]}return e}function Vh(i){const e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function sc(i){const e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:et.workingColorSpace}const Wh={clone:Ci,merge:Et};var Xh=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Yh=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Dn extends Zn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Xh,this.fragmentShader=Yh,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ci(e.uniforms),this.uniformsGroups=Vh(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const s in this.uniforms){const a=this.uniforms[s].value;a&&a.isTexture?t.uniforms[s]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[s]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[s]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[s]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[s]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[s]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[s]={type:"m4",value:a.toArray()}:t.uniforms[s]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class rc extends gt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new st,this.projectionMatrix=new st,this.projectionMatrixInverse=new st,this.coordinateSystem=dn}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const yn=new O,Fo=new Ue,Oo=new Ue;class Bt extends rc{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=Ba*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(Fs*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Ba*2*Math.atan(Math.tan(Fs*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){yn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(yn.x,yn.y).multiplyScalar(-e/yn.z),yn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(yn.x,yn.y).multiplyScalar(-e/yn.z)}getViewSize(e,t){return this.getViewBounds(e,Fo,Oo),t.subVectors(Oo,Fo)}setViewOffset(e,t,n,s,r,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(Fs*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s;const a=this.view;if(this.view!==null&&this.view.enabled){const l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*s/l,t-=a.offsetY*n/c,s*=a.width/l,n*=a.height/c}const o=this.filmOffset;o!==0&&(r+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const di=-90,fi=1;class qh extends gt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const s=new Bt(di,fi,e,t);s.layers=this.layers,this.add(s);const r=new Bt(di,fi,e,t);r.layers=this.layers,this.add(r);const a=new Bt(di,fi,e,t);a.layers=this.layers,this.add(a);const o=new Bt(di,fi,e,t);o.layers=this.layers,this.add(o);const l=new Bt(di,fi,e,t);l.layers=this.layers,this.add(l);const c=new Bt(di,fi,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,s,r,a,o,l]=t;for(const c of t)this.remove(c);if(e===dn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Ws)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[r,a,o,l,c,h]=this.children,m=e.getRenderTarget(),p=e.getActiveCubeFace(),u=e.getActiveMipmapLevel(),_=e.xr.enabled;e.xr.enabled=!1;const M=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,a),e.setRenderTarget(n,2,s),e.render(t,o),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=M,e.setRenderTarget(n,5,s),e.render(t,h),e.setRenderTarget(m,p,u),e.xr.enabled=_,n.texture.needsPMREMUpdate=!0}}class ac extends Rt{constructor(e,t,n,s,r,a,o,l,c,h){e=e!==void 0?e:[],t=t!==void 0?t:Ti,super(e,t,n,s,r,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class jh extends qn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new ac(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:qt}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new Zi(5,5,5),r=new Dn({name:"CubemapFromEquirect",uniforms:Ci(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:wt,blending:Cn});r.uniforms.tEquirect.value=t;const a=new kt(s,r),o=t.minFilter;return t.minFilter===Xn&&(t.minFilter=qt),new qh(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t,n,s){const r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,s);e.setRenderTarget(r)}}const Ur=new O,Kh=new O,$h=new Ge;class En{constructor(e=new O(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const s=Ur.subVectors(n,t).cross(Kh.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(Ur),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||$h.getNormalMatrix(e),s=this.coplanarPoint(Ur).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const On=new tr,Ss=new O;class Qa{constructor(e=new En,t=new En,n=new En,s=new En,r=new En,a=new En){this.planes=[e,t,n,s,r,a]}set(e,t,n,s,r,a){const o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(s),o[4].copy(r),o[5].copy(a),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=dn){const n=this.planes,s=e.elements,r=s[0],a=s[1],o=s[2],l=s[3],c=s[4],h=s[5],m=s[6],p=s[7],u=s[8],_=s[9],M=s[10],f=s[11],d=s[12],E=s[13],S=s[14],T=s[15];if(n[0].setComponents(l-r,p-c,f-u,T-d).normalize(),n[1].setComponents(l+r,p+c,f+u,T+d).normalize(),n[2].setComponents(l+a,p+h,f+_,T+E).normalize(),n[3].setComponents(l-a,p-h,f-_,T-E).normalize(),n[4].setComponents(l-o,p-m,f-M,T-S).normalize(),t===dn)n[5].setComponents(l+o,p+m,f+M,T+S).normalize();else if(t===Ws)n[5].setComponents(o,m,M,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),On.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),On.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(On)}intersectsSprite(e){return On.center.set(0,0,0),On.radius=.7071067811865476,On.applyMatrix4(e.matrixWorld),this.intersectsSphere(On)}intersectsSphere(e){const t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const s=t[n];if(Ss.x=s.normal.x>0?e.max.x:e.min.x,Ss.y=s.normal.y>0?e.max.y:e.min.y,Ss.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Ss)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function oc(){let i=null,e=!1,t=null,n=null;function s(r,a){t(r,a),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function Zh(i){const e=new WeakMap;function t(o,l){const c=o.array,h=o.usage,m=c.byteLength,p=i.createBuffer();i.bindBuffer(l,p),i.bufferData(l,c,h),o.onUploadCallback();let u;if(c instanceof Float32Array)u=i.FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?u=i.HALF_FLOAT:u=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)u=i.SHORT;else if(c instanceof Uint32Array)u=i.UNSIGNED_INT;else if(c instanceof Int32Array)u=i.INT;else if(c instanceof Int8Array)u=i.BYTE;else if(c instanceof Uint8Array)u=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)u=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:p,type:u,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:m}}function n(o,l,c){const h=l.array,m=l.updateRanges;if(i.bindBuffer(c,o),m.length===0)i.bufferSubData(c,0,h);else{m.sort((u,_)=>u.start-_.start);let p=0;for(let u=1;u<m.length;u++){const _=m[p],M=m[u];M.start<=_.start+_.count+1?_.count=Math.max(_.count,M.start+M.count-_.start):(++p,m[p]=M)}m.length=p+1;for(let u=0,_=m.length;u<_;u++){const M=m[u];i.bufferSubData(c,M.start*h.BYTES_PER_ELEMENT,h,M.start,M.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);const l=e.get(o);l&&(i.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const c=e.get(o);if(c===void 0)e.set(o,t(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:s,remove:r,update:a}}class ir extends Ut{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};const r=e/2,a=t/2,o=Math.floor(n),l=Math.floor(s),c=o+1,h=l+1,m=e/o,p=t/l,u=[],_=[],M=[],f=[];for(let d=0;d<h;d++){const E=d*p-a;for(let S=0;S<c;S++){const T=S*m-r;_.push(T,-E,0),M.push(0,0,1),f.push(S/o),f.push(1-d/l)}}for(let d=0;d<l;d++)for(let E=0;E<o;E++){const S=E+c*d,T=E+c*(d+1),z=E+1+c*(d+1),D=E+1+c*d;u.push(S,T,D),u.push(T,z,D)}this.setIndex(u),this.setAttribute("position",new Ct(_,3)),this.setAttribute("normal",new Ct(M,3)),this.setAttribute("uv",new Ct(f,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ir(e.width,e.height,e.widthSegments,e.heightSegments)}}var Jh=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Qh=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,eu=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,tu=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,nu=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,iu=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,su=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,ru=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,au=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,ou=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,lu=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,cu=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,hu=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,uu=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,du=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,fu=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,pu=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,mu=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,_u=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,gu=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,vu=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,xu=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,Mu=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,Su=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,yu=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Eu=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,bu=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Tu=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Au=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,wu=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Ru="gl_FragColor = linearToOutputTexel( gl_FragColor );",Cu=`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Pu=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Lu=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Du=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Iu=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Nu=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Uu=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Fu=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Ou=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Bu=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,zu=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,ku=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Hu=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Gu=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Vu=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Wu=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Xu=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Yu=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,qu=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,ju=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Ku=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,$u=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Zu=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Ju=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Qu=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,ed=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,td=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,nd=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,id=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,sd=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,rd=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,ad=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,od=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,ld=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,cd=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,hd=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,ud=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,dd=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,fd=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,pd=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,md=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,_d=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,gd=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,vd=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,xd=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Md=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Sd=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,yd=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Ed=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,bd=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Td=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Ad=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,wd=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Rd=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Cd=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Pd=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Ld=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Dd=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Id=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,Nd=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Ud=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Fd=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Od=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Bd=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,zd=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,kd=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Hd=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Gd=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Vd=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Wd=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Xd=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Yd=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
		
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
		
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		
		#else
		
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,qd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,jd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Kd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,$d=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Zd=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Jd=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Qd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,ef=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,tf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,nf=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,sf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,rf=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,af=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,of=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,lf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,cf=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,hf=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,uf=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,df=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,ff=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,pf=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,mf=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,_f=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,gf=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vf=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,xf=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,Mf=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Sf=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,yf=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Ef=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,bf=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Tf=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Af=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,wf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Rf=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Cf=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Pf=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Lf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,He={alphahash_fragment:Jh,alphahash_pars_fragment:Qh,alphamap_fragment:eu,alphamap_pars_fragment:tu,alphatest_fragment:nu,alphatest_pars_fragment:iu,aomap_fragment:su,aomap_pars_fragment:ru,batching_pars_vertex:au,batching_vertex:ou,begin_vertex:lu,beginnormal_vertex:cu,bsdfs:hu,iridescence_fragment:uu,bumpmap_pars_fragment:du,clipping_planes_fragment:fu,clipping_planes_pars_fragment:pu,clipping_planes_pars_vertex:mu,clipping_planes_vertex:_u,color_fragment:gu,color_pars_fragment:vu,color_pars_vertex:xu,color_vertex:Mu,common:Su,cube_uv_reflection_fragment:yu,defaultnormal_vertex:Eu,displacementmap_pars_vertex:bu,displacementmap_vertex:Tu,emissivemap_fragment:Au,emissivemap_pars_fragment:wu,colorspace_fragment:Ru,colorspace_pars_fragment:Cu,envmap_fragment:Pu,envmap_common_pars_fragment:Lu,envmap_pars_fragment:Du,envmap_pars_vertex:Iu,envmap_physical_pars_fragment:Wu,envmap_vertex:Nu,fog_vertex:Uu,fog_pars_vertex:Fu,fog_fragment:Ou,fog_pars_fragment:Bu,gradientmap_pars_fragment:zu,lightmap_pars_fragment:ku,lights_lambert_fragment:Hu,lights_lambert_pars_fragment:Gu,lights_pars_begin:Vu,lights_toon_fragment:Xu,lights_toon_pars_fragment:Yu,lights_phong_fragment:qu,lights_phong_pars_fragment:ju,lights_physical_fragment:Ku,lights_physical_pars_fragment:$u,lights_fragment_begin:Zu,lights_fragment_maps:Ju,lights_fragment_end:Qu,logdepthbuf_fragment:ed,logdepthbuf_pars_fragment:td,logdepthbuf_pars_vertex:nd,logdepthbuf_vertex:id,map_fragment:sd,map_pars_fragment:rd,map_particle_fragment:ad,map_particle_pars_fragment:od,metalnessmap_fragment:ld,metalnessmap_pars_fragment:cd,morphinstance_vertex:hd,morphcolor_vertex:ud,morphnormal_vertex:dd,morphtarget_pars_vertex:fd,morphtarget_vertex:pd,normal_fragment_begin:md,normal_fragment_maps:_d,normal_pars_fragment:gd,normal_pars_vertex:vd,normal_vertex:xd,normalmap_pars_fragment:Md,clearcoat_normal_fragment_begin:Sd,clearcoat_normal_fragment_maps:yd,clearcoat_pars_fragment:Ed,iridescence_pars_fragment:bd,opaque_fragment:Td,packing:Ad,premultiplied_alpha_fragment:wd,project_vertex:Rd,dithering_fragment:Cd,dithering_pars_fragment:Pd,roughnessmap_fragment:Ld,roughnessmap_pars_fragment:Dd,shadowmap_pars_fragment:Id,shadowmap_pars_vertex:Nd,shadowmap_vertex:Ud,shadowmask_pars_fragment:Fd,skinbase_vertex:Od,skinning_pars_vertex:Bd,skinning_vertex:zd,skinnormal_vertex:kd,specularmap_fragment:Hd,specularmap_pars_fragment:Gd,tonemapping_fragment:Vd,tonemapping_pars_fragment:Wd,transmission_fragment:Xd,transmission_pars_fragment:Yd,uv_pars_fragment:qd,uv_pars_vertex:jd,uv_vertex:Kd,worldpos_vertex:$d,background_vert:Zd,background_frag:Jd,backgroundCube_vert:Qd,backgroundCube_frag:ef,cube_vert:tf,cube_frag:nf,depth_vert:sf,depth_frag:rf,distanceRGBA_vert:af,distanceRGBA_frag:of,equirect_vert:lf,equirect_frag:cf,linedashed_vert:hf,linedashed_frag:uf,meshbasic_vert:df,meshbasic_frag:ff,meshlambert_vert:pf,meshlambert_frag:mf,meshmatcap_vert:_f,meshmatcap_frag:gf,meshnormal_vert:vf,meshnormal_frag:xf,meshphong_vert:Mf,meshphong_frag:Sf,meshphysical_vert:yf,meshphysical_frag:Ef,meshtoon_vert:bf,meshtoon_frag:Tf,points_vert:Af,points_frag:wf,shadow_vert:Rf,shadow_frag:Cf,sprite_vert:Pf,sprite_frag:Lf},ue={common:{diffuse:{value:new Ye(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ge}},envmap:{envMap:{value:null},envMapRotation:{value:new Ge},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ge}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ge}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ge},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ge},normalScale:{value:new Ue(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ge},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ge}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ge}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ge}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ye(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ye(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0},uvTransform:{value:new Ge}},sprite:{diffuse:{value:new Ye(16777215)},opacity:{value:1},center:{value:new Ue(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}}},Jt={basic:{uniforms:Et([ue.common,ue.specularmap,ue.envmap,ue.aomap,ue.lightmap,ue.fog]),vertexShader:He.meshbasic_vert,fragmentShader:He.meshbasic_frag},lambert:{uniforms:Et([ue.common,ue.specularmap,ue.envmap,ue.aomap,ue.lightmap,ue.emissivemap,ue.bumpmap,ue.normalmap,ue.displacementmap,ue.fog,ue.lights,{emissive:{value:new Ye(0)}}]),vertexShader:He.meshlambert_vert,fragmentShader:He.meshlambert_frag},phong:{uniforms:Et([ue.common,ue.specularmap,ue.envmap,ue.aomap,ue.lightmap,ue.emissivemap,ue.bumpmap,ue.normalmap,ue.displacementmap,ue.fog,ue.lights,{emissive:{value:new Ye(0)},specular:{value:new Ye(1118481)},shininess:{value:30}}]),vertexShader:He.meshphong_vert,fragmentShader:He.meshphong_frag},standard:{uniforms:Et([ue.common,ue.envmap,ue.aomap,ue.lightmap,ue.emissivemap,ue.bumpmap,ue.normalmap,ue.displacementmap,ue.roughnessmap,ue.metalnessmap,ue.fog,ue.lights,{emissive:{value:new Ye(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag},toon:{uniforms:Et([ue.common,ue.aomap,ue.lightmap,ue.emissivemap,ue.bumpmap,ue.normalmap,ue.displacementmap,ue.gradientmap,ue.fog,ue.lights,{emissive:{value:new Ye(0)}}]),vertexShader:He.meshtoon_vert,fragmentShader:He.meshtoon_frag},matcap:{uniforms:Et([ue.common,ue.bumpmap,ue.normalmap,ue.displacementmap,ue.fog,{matcap:{value:null}}]),vertexShader:He.meshmatcap_vert,fragmentShader:He.meshmatcap_frag},points:{uniforms:Et([ue.points,ue.fog]),vertexShader:He.points_vert,fragmentShader:He.points_frag},dashed:{uniforms:Et([ue.common,ue.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:He.linedashed_vert,fragmentShader:He.linedashed_frag},depth:{uniforms:Et([ue.common,ue.displacementmap]),vertexShader:He.depth_vert,fragmentShader:He.depth_frag},normal:{uniforms:Et([ue.common,ue.bumpmap,ue.normalmap,ue.displacementmap,{opacity:{value:1}}]),vertexShader:He.meshnormal_vert,fragmentShader:He.meshnormal_frag},sprite:{uniforms:Et([ue.sprite,ue.fog]),vertexShader:He.sprite_vert,fragmentShader:He.sprite_frag},background:{uniforms:{uvTransform:{value:new Ge},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:He.background_vert,fragmentShader:He.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ge}},vertexShader:He.backgroundCube_vert,fragmentShader:He.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:He.cube_vert,fragmentShader:He.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:He.equirect_vert,fragmentShader:He.equirect_frag},distanceRGBA:{uniforms:Et([ue.common,ue.displacementmap,{referencePosition:{value:new O},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:He.distanceRGBA_vert,fragmentShader:He.distanceRGBA_frag},shadow:{uniforms:Et([ue.lights,ue.fog,{color:{value:new Ye(0)},opacity:{value:1}}]),vertexShader:He.shadow_vert,fragmentShader:He.shadow_frag}};Jt.physical={uniforms:Et([Jt.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ge},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ge},clearcoatNormalScale:{value:new Ue(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ge},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ge},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ge},sheen:{value:0},sheenColor:{value:new Ye(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ge},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ge},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ge},transmissionSamplerSize:{value:new Ue},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ge},attenuationDistance:{value:0},attenuationColor:{value:new Ye(0)},specularColor:{value:new Ye(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ge},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ge},anisotropyVector:{value:new Ue},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ge}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag};const ys={r:0,b:0,g:0},Bn=new tn,Df=new st;function If(i,e,t,n,s,r,a){const o=new Ye(0);let l=r===!0?0:1,c,h,m=null,p=0,u=null;function _(E){let S=E.isScene===!0?E.background:null;return S&&S.isTexture&&(S=(E.backgroundBlurriness>0?t:e).get(S)),S}function M(E){let S=!1;const T=_(E);T===null?d(o,l):T&&T.isColor&&(d(T,1),S=!0);const z=i.xr.getEnvironmentBlendMode();z==="additive"?n.buffers.color.setClear(0,0,0,1,a):z==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,a),(i.autoClear||S)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function f(E,S){const T=_(S);T&&(T.isCubeTexture||T.mapping===Qs)?(h===void 0&&(h=new kt(new Zi(1,1,1),new Dn({name:"BackgroundCubeMaterial",uniforms:Ci(Jt.backgroundCube.uniforms),vertexShader:Jt.backgroundCube.vertexShader,fragmentShader:Jt.backgroundCube.fragmentShader,side:wt,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(z,D,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(h)),Bn.copy(S.backgroundRotation),Bn.x*=-1,Bn.y*=-1,Bn.z*=-1,T.isCubeTexture&&T.isRenderTargetTexture===!1&&(Bn.y*=-1,Bn.z*=-1),h.material.uniforms.envMap.value=T,h.material.uniforms.flipEnvMap.value=T.isCubeTexture&&T.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=S.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(Df.makeRotationFromEuler(Bn)),h.material.toneMapped=et.getTransfer(T.colorSpace)!==at,(m!==T||p!==T.version||u!==i.toneMapping)&&(h.material.needsUpdate=!0,m=T,p=T.version,u=i.toneMapping),h.layers.enableAll(),E.unshift(h,h.geometry,h.material,0,0,null)):T&&T.isTexture&&(c===void 0&&(c=new kt(new ir(2,2),new Dn({name:"BackgroundMaterial",uniforms:Ci(Jt.background.uniforms),vertexShader:Jt.background.vertexShader,fragmentShader:Jt.background.fragmentShader,side:Ln,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=T,c.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,c.material.toneMapped=et.getTransfer(T.colorSpace)!==at,T.matrixAutoUpdate===!0&&T.updateMatrix(),c.material.uniforms.uvTransform.value.copy(T.matrix),(m!==T||p!==T.version||u!==i.toneMapping)&&(c.material.needsUpdate=!0,m=T,p=T.version,u=i.toneMapping),c.layers.enableAll(),E.unshift(c,c.geometry,c.material,0,0,null))}function d(E,S){E.getRGB(ys,sc(i)),n.buffers.color.setClear(ys.r,ys.g,ys.b,S,a)}return{getClearColor:function(){return o},setClearColor:function(E,S=1){o.set(E),l=S,d(o,l)},getClearAlpha:function(){return l},setClearAlpha:function(E){l=E,d(o,l)},render:M,addToRenderList:f}}function Nf(i,e){const t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=p(null);let r=s,a=!1;function o(g,y,W,H,Q){let re=!1;const Y=m(H,W,y);r!==Y&&(r=Y,c(r.object)),re=u(g,H,W,Q),re&&_(g,H,W,Q),Q!==null&&e.update(Q,i.ELEMENT_ARRAY_BUFFER),(re||a)&&(a=!1,T(g,y,W,H),Q!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(Q).buffer))}function l(){return i.createVertexArray()}function c(g){return i.bindVertexArray(g)}function h(g){return i.deleteVertexArray(g)}function m(g,y,W){const H=W.wireframe===!0;let Q=n[g.id];Q===void 0&&(Q={},n[g.id]=Q);let re=Q[y.id];re===void 0&&(re={},Q[y.id]=re);let Y=re[H];return Y===void 0&&(Y=p(l()),re[H]=Y),Y}function p(g){const y=[],W=[],H=[];for(let Q=0;Q<t;Q++)y[Q]=0,W[Q]=0,H[Q]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:y,enabledAttributes:W,attributeDivisors:H,object:g,attributes:{},index:null}}function u(g,y,W,H){const Q=r.attributes,re=y.attributes;let Y=0;const ne=W.getAttributes();for(const V in ne)if(ne[V].location>=0){const Me=Q[V];let ye=re[V];if(ye===void 0&&(V==="instanceMatrix"&&g.instanceMatrix&&(ye=g.instanceMatrix),V==="instanceColor"&&g.instanceColor&&(ye=g.instanceColor)),Me===void 0||Me.attribute!==ye||ye&&Me.data!==ye.data)return!0;Y++}return r.attributesNum!==Y||r.index!==H}function _(g,y,W,H){const Q={},re=y.attributes;let Y=0;const ne=W.getAttributes();for(const V in ne)if(ne[V].location>=0){let Me=re[V];Me===void 0&&(V==="instanceMatrix"&&g.instanceMatrix&&(Me=g.instanceMatrix),V==="instanceColor"&&g.instanceColor&&(Me=g.instanceColor));const ye={};ye.attribute=Me,Me&&Me.data&&(ye.data=Me.data),Q[V]=ye,Y++}r.attributes=Q,r.attributesNum=Y,r.index=H}function M(){const g=r.newAttributes;for(let y=0,W=g.length;y<W;y++)g[y]=0}function f(g){d(g,0)}function d(g,y){const W=r.newAttributes,H=r.enabledAttributes,Q=r.attributeDivisors;W[g]=1,H[g]===0&&(i.enableVertexAttribArray(g),H[g]=1),Q[g]!==y&&(i.vertexAttribDivisor(g,y),Q[g]=y)}function E(){const g=r.newAttributes,y=r.enabledAttributes;for(let W=0,H=y.length;W<H;W++)y[W]!==g[W]&&(i.disableVertexAttribArray(W),y[W]=0)}function S(g,y,W,H,Q,re,Y){Y===!0?i.vertexAttribIPointer(g,y,W,Q,re):i.vertexAttribPointer(g,y,W,H,Q,re)}function T(g,y,W,H){M();const Q=H.attributes,re=W.getAttributes(),Y=y.defaultAttributeValues;for(const ne in re){const V=re[ne];if(V.location>=0){let ve=Q[ne];if(ve===void 0&&(ne==="instanceMatrix"&&g.instanceMatrix&&(ve=g.instanceMatrix),ne==="instanceColor"&&g.instanceColor&&(ve=g.instanceColor)),ve!==void 0){const Me=ve.normalized,ye=ve.itemSize,ze=e.get(ve);if(ze===void 0)continue;const Be=ze.buffer,j=ze.type,ae=ze.bytesPerElement,Ee=j===i.INT||j===i.UNSIGNED_INT||ve.gpuType===Wa;if(ve.isInterleavedBufferAttribute){const Se=ve.data,Oe=Se.stride,Le=ve.offset;if(Se.isInstancedInterleavedBuffer){for(let qe=0;qe<V.locationSize;qe++)d(V.location+qe,Se.meshPerAttribute);g.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=Se.meshPerAttribute*Se.count)}else for(let qe=0;qe<V.locationSize;qe++)f(V.location+qe);i.bindBuffer(i.ARRAY_BUFFER,Be);for(let qe=0;qe<V.locationSize;qe++)S(V.location+qe,ye/V.locationSize,j,Me,Oe*ae,(Le+ye/V.locationSize*qe)*ae,Ee)}else{if(ve.isInstancedBufferAttribute){for(let Se=0;Se<V.locationSize;Se++)d(V.location+Se,ve.meshPerAttribute);g.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=ve.meshPerAttribute*ve.count)}else for(let Se=0;Se<V.locationSize;Se++)f(V.location+Se);i.bindBuffer(i.ARRAY_BUFFER,Be);for(let Se=0;Se<V.locationSize;Se++)S(V.location+Se,ye/V.locationSize,j,Me,ye*ae,ye/V.locationSize*Se*ae,Ee)}}else if(Y!==void 0){const Me=Y[ne];if(Me!==void 0)switch(Me.length){case 2:i.vertexAttrib2fv(V.location,Me);break;case 3:i.vertexAttrib3fv(V.location,Me);break;case 4:i.vertexAttrib4fv(V.location,Me);break;default:i.vertexAttrib1fv(V.location,Me)}}}}E()}function z(){B();for(const g in n){const y=n[g];for(const W in y){const H=y[W];for(const Q in H)h(H[Q].object),delete H[Q];delete y[W]}delete n[g]}}function D(g){if(n[g.id]===void 0)return;const y=n[g.id];for(const W in y){const H=y[W];for(const Q in H)h(H[Q].object),delete H[Q];delete y[W]}delete n[g.id]}function A(g){for(const y in n){const W=n[y];if(W[g.id]===void 0)continue;const H=W[g.id];for(const Q in H)h(H[Q].object),delete H[Q];delete W[g.id]}}function B(){ie(),a=!0,r!==s&&(r=s,c(r.object))}function ie(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:o,reset:B,resetDefaultState:ie,dispose:z,releaseStatesOfGeometry:D,releaseStatesOfProgram:A,initAttributes:M,enableAttribute:f,disableUnusedAttributes:E}}function Uf(i,e,t){let n;function s(c){n=c}function r(c,h){i.drawArrays(n,c,h),t.update(h,n,1)}function a(c,h,m){m!==0&&(i.drawArraysInstanced(n,c,h,m),t.update(h,n,m))}function o(c,h,m){if(m===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,h,0,m);let u=0;for(let _=0;_<m;_++)u+=h[_];t.update(u,n,1)}function l(c,h,m,p){if(m===0)return;const u=e.get("WEBGL_multi_draw");if(u===null)for(let _=0;_<c.length;_++)a(c[_],h[_],p[_]);else{u.multiDrawArraysInstancedWEBGL(n,c,0,h,0,p,0,m);let _=0;for(let M=0;M<m;M++)_+=h[M];for(let M=0;M<p.length;M++)t.update(_,n,p[M])}}this.setMode=s,this.render=r,this.renderInstances=a,this.renderMultiDraw=o,this.renderMultiDrawInstances=l}function Ff(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){const A=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function a(A){return!(A!==Kt&&n.convert(A)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(A){const B=A===ji&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(A!==pn&&n.convert(A)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==un&&!B)}function l(A){if(A==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp";const h=l(c);h!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);const m=t.logarithmicDepthBuffer===!0,p=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control");if(p===!0){const A=e.get("EXT_clip_control");A.clipControlEXT(A.LOWER_LEFT_EXT,A.ZERO_TO_ONE_EXT)}const u=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),_=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),M=i.getParameter(i.MAX_TEXTURE_SIZE),f=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),d=i.getParameter(i.MAX_VERTEX_ATTRIBS),E=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),S=i.getParameter(i.MAX_VARYING_VECTORS),T=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),z=_>0,D=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:m,reverseDepthBuffer:p,maxTextures:u,maxVertexTextures:_,maxTextureSize:M,maxCubemapSize:f,maxAttributes:d,maxVertexUniforms:E,maxVaryings:S,maxFragmentUniforms:T,vertexTextures:z,maxSamples:D}}function Of(i){const e=this;let t=null,n=0,s=!1,r=!1;const a=new En,o=new Ge,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(m,p){const u=m.length!==0||p||n!==0||s;return s=p,n=m.length,u},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(m,p){t=h(m,p,0)},this.setState=function(m,p,u){const _=m.clippingPlanes,M=m.clipIntersection,f=m.clipShadows,d=i.get(m);if(!s||_===null||_.length===0||r&&!f)r?h(null):c();else{const E=r?0:n,S=E*4;let T=d.clippingState||null;l.value=T,T=h(_,p,S,u);for(let z=0;z!==S;++z)T[z]=t[z];d.clippingState=T,this.numIntersection=M?this.numPlanes:0,this.numPlanes+=E}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(m,p,u,_){const M=m!==null?m.length:0;let f=null;if(M!==0){if(f=l.value,_!==!0||f===null){const d=u+M*4,E=p.matrixWorldInverse;o.getNormalMatrix(E),(f===null||f.length<d)&&(f=new Float32Array(d));for(let S=0,T=u;S!==M;++S,T+=4)a.copy(m[S]).applyMatrix4(E,o),a.normal.toArray(f,T),f[T+3]=a.constant}l.value=f,l.needsUpdate=!0}return e.numPlanes=M,e.numIntersection=0,f}}function Bf(i){let e=new WeakMap;function t(a,o){return o===la?a.mapping=Ti:o===ca&&(a.mapping=Ai),a}function n(a){if(a&&a.isTexture){const o=a.mapping;if(o===la||o===ca)if(e.has(a)){const l=e.get(a).texture;return t(l,a.mapping)}else{const l=a.image;if(l&&l.height>0){const c=new jh(l.height);return c.fromEquirectangularTexture(i,a),e.set(a,c),a.addEventListener("dispose",s),t(c.texture,a.mapping)}else return null}}return a}function s(a){const o=a.target;o.removeEventListener("dispose",s);const l=e.get(o);l!==void 0&&(e.delete(o),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}class lc extends rc{constructor(e=-1,t=1,n=1,s=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2;let r=n-e,a=n+e,o=s+t,l=s-t;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}const gi=4,Bo=[.125,.215,.35,.446,.526,.582],Vn=20,Fr=new lc,zo=new Ye;let Or=null,Br=0,zr=0,kr=!1;const Hn=(1+Math.sqrt(5))/2,pi=1/Hn,ko=[new O(-Hn,pi,0),new O(Hn,pi,0),new O(-pi,0,Hn),new O(pi,0,Hn),new O(0,Hn,-pi),new O(0,Hn,pi),new O(-1,1,-1),new O(1,1,-1),new O(-1,1,1),new O(1,1,1)];class Ho{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){Or=this._renderer.getRenderTarget(),Br=this._renderer.getActiveCubeFace(),zr=this._renderer.getActiveMipmapLevel(),kr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Wo(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Vo(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Or,Br,zr),this._renderer.xr.enabled=kr,e.scissorTest=!1,Es(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Ti||e.mapping===Ai?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Or=this._renderer.getRenderTarget(),Br=this._renderer.getActiveCubeFace(),zr=this._renderer.getActiveMipmapLevel(),kr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:qt,minFilter:qt,generateMipmaps:!1,type:ji,format:Kt,colorSpace:In,depthBuffer:!1},s=Go(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Go(e,t,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=zf(r)),this._blurMaterial=kf(r,e,t)}return s}_compileMaterial(e){const t=new kt(this._lodPlanes[0],e);this._renderer.compile(t,Fr)}_sceneToCubeUV(e,t,n,s){const o=new Bt(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],h=this._renderer,m=h.autoClear,p=h.toneMapping;h.getClearColor(zo),h.toneMapping=Pn,h.autoClear=!1;const u=new Ja({name:"PMREM.Background",side:wt,depthWrite:!1,depthTest:!1}),_=new kt(new Zi,u);let M=!1;const f=e.background;f?f.isColor&&(u.color.copy(f),e.background=null,M=!0):(u.color.copy(zo),M=!0);for(let d=0;d<6;d++){const E=d%3;E===0?(o.up.set(0,l[d],0),o.lookAt(c[d],0,0)):E===1?(o.up.set(0,0,l[d]),o.lookAt(0,c[d],0)):(o.up.set(0,l[d],0),o.lookAt(0,0,c[d]));const S=this._cubeSize;Es(s,E*S,d>2?S:0,S,S),h.setRenderTarget(s),M&&h.render(_,o),h.render(e,o)}_.geometry.dispose(),_.material.dispose(),h.toneMapping=p,h.autoClear=m,e.background=f}_textureToCubeUV(e,t){const n=this._renderer,s=e.mapping===Ti||e.mapping===Ai;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Wo()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Vo());const r=s?this._cubemapMaterial:this._equirectMaterial,a=new kt(this._lodPlanes[0],r),o=r.uniforms;o.envMap.value=e;const l=this._cubeSize;Es(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(a,Fr)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;const s=this._lodPlanes.length;for(let r=1;r<s;r++){const a=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),o=ko[(s-r-1)%ko.length];this._blur(e,r-1,r,a,o)}t.autoClear=n}_blur(e,t,n,s,r){const a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,s,"latitudinal",r),this._halfBlur(a,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,a,o){const l=this._renderer,c=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,m=new kt(this._lodPlanes[s],c),p=c.uniforms,u=this._sizeLods[n]-1,_=isFinite(r)?Math.PI/(2*u):2*Math.PI/(2*Vn-1),M=r/_,f=isFinite(r)?1+Math.floor(h*M):Vn;f>Vn&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${f} samples when the maximum is set to ${Vn}`);const d=[];let E=0;for(let A=0;A<Vn;++A){const B=A/M,ie=Math.exp(-B*B/2);d.push(ie),A===0?E+=ie:A<f&&(E+=2*ie)}for(let A=0;A<d.length;A++)d[A]=d[A]/E;p.envMap.value=e.texture,p.samples.value=f,p.weights.value=d,p.latitudinal.value=a==="latitudinal",o&&(p.poleAxis.value=o);const{_lodMax:S}=this;p.dTheta.value=_,p.mipInt.value=S-n;const T=this._sizeLods[s],z=3*T*(s>S-gi?s-S+gi:0),D=4*(this._cubeSize-T);Es(t,z,D,3*T,2*T),l.setRenderTarget(t),l.render(m,Fr)}}function zf(i){const e=[],t=[],n=[];let s=i;const r=i-gi+1+Bo.length;for(let a=0;a<r;a++){const o=Math.pow(2,s);t.push(o);let l=1/o;a>i-gi?l=Bo[a-i+gi-1]:a===0&&(l=0),n.push(l);const c=1/(o-2),h=-c,m=1+c,p=[h,h,m,h,m,m,h,h,m,m,h,m],u=6,_=6,M=3,f=2,d=1,E=new Float32Array(M*_*u),S=new Float32Array(f*_*u),T=new Float32Array(d*_*u);for(let D=0;D<u;D++){const A=D%3*2/3-1,B=D>2?0:-1,ie=[A,B,0,A+2/3,B,0,A+2/3,B+1,0,A,B,0,A+2/3,B+1,0,A,B+1,0];E.set(ie,M*_*D),S.set(p,f*_*D);const g=[D,D,D,D,D,D];T.set(g,d*_*D)}const z=new Ut;z.setAttribute("position",new en(E,M)),z.setAttribute("uv",new en(S,f)),z.setAttribute("faceIndex",new en(T,d)),e.push(z),s>gi&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Go(i,e,t){const n=new qn(i,e,t);return n.texture.mapping=Qs,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Es(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function kf(i,e,t){const n=new Float32Array(Vn),s=new O(0,1,0);return new Dn({name:"SphericalGaussianBlur",defines:{n:Vn,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:eo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Cn,depthTest:!1,depthWrite:!1})}function Vo(){return new Dn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:eo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Cn,depthTest:!1,depthWrite:!1})}function Wo(){return new Dn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:eo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Cn,depthTest:!1,depthWrite:!1})}function eo(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Hf(i){let e=new WeakMap,t=null;function n(o){if(o&&o.isTexture){const l=o.mapping,c=l===la||l===ca,h=l===Ti||l===Ai;if(c||h){let m=e.get(o);const p=m!==void 0?m.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==p)return t===null&&(t=new Ho(i)),m=c?t.fromEquirectangular(o,m):t.fromCubemap(o,m),m.texture.pmremVersion=o.pmremVersion,e.set(o,m),m.texture;if(m!==void 0)return m.texture;{const u=o.image;return c&&u&&u.height>0||h&&u&&s(u)?(t===null&&(t=new Ho(i)),m=c?t.fromEquirectangular(o):t.fromCubemap(o),m.texture.pmremVersion=o.pmremVersion,e.set(o,m),o.addEventListener("dispose",r),m.texture):null}}}return o}function s(o){let l=0;const c=6;for(let h=0;h<c;h++)o[h]!==void 0&&l++;return l===c}function r(o){const l=o.target;l.removeEventListener("dispose",r);const c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function a(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:a}}function Gf(i){const e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){const s=t(n);return s===null&&Os("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function Vf(i,e,t,n){const s={},r=new WeakMap;function a(m){const p=m.target;p.index!==null&&e.remove(p.index);for(const _ in p.attributes)e.remove(p.attributes[_]);for(const _ in p.morphAttributes){const M=p.morphAttributes[_];for(let f=0,d=M.length;f<d;f++)e.remove(M[f])}p.removeEventListener("dispose",a),delete s[p.id];const u=r.get(p);u&&(e.remove(u),r.delete(p)),n.releaseStatesOfGeometry(p),p.isInstancedBufferGeometry===!0&&delete p._maxInstanceCount,t.memory.geometries--}function o(m,p){return s[p.id]===!0||(p.addEventListener("dispose",a),s[p.id]=!0,t.memory.geometries++),p}function l(m){const p=m.attributes;for(const _ in p)e.update(p[_],i.ARRAY_BUFFER);const u=m.morphAttributes;for(const _ in u){const M=u[_];for(let f=0,d=M.length;f<d;f++)e.update(M[f],i.ARRAY_BUFFER)}}function c(m){const p=[],u=m.index,_=m.attributes.position;let M=0;if(u!==null){const E=u.array;M=u.version;for(let S=0,T=E.length;S<T;S+=3){const z=E[S+0],D=E[S+1],A=E[S+2];p.push(z,D,D,A,A,z)}}else if(_!==void 0){const E=_.array;M=_.version;for(let S=0,T=E.length/3-1;S<T;S+=3){const z=S+0,D=S+1,A=S+2;p.push(z,D,D,A,A,z)}}else return;const f=new(Jl(p)?ic:nc)(p,1);f.version=M;const d=r.get(m);d&&e.remove(d),r.set(m,f)}function h(m){const p=r.get(m);if(p){const u=m.index;u!==null&&p.version<u.version&&c(m)}else c(m);return r.get(m)}return{get:o,update:l,getWireframeAttribute:h}}function Wf(i,e,t){let n;function s(p){n=p}let r,a;function o(p){r=p.type,a=p.bytesPerElement}function l(p,u){i.drawElements(n,u,r,p*a),t.update(u,n,1)}function c(p,u,_){_!==0&&(i.drawElementsInstanced(n,u,r,p*a,_),t.update(u,n,_))}function h(p,u,_){if(_===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,u,0,r,p,0,_);let f=0;for(let d=0;d<_;d++)f+=u[d];t.update(f,n,1)}function m(p,u,_,M){if(_===0)return;const f=e.get("WEBGL_multi_draw");if(f===null)for(let d=0;d<p.length;d++)c(p[d]/a,u[d],M[d]);else{f.multiDrawElementsInstancedWEBGL(n,u,0,r,p,0,M,0,_);let d=0;for(let E=0;E<_;E++)d+=u[E];for(let E=0;E<M.length;E++)t.update(d,n,M[E])}}this.setMode=s,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h,this.renderMultiDrawInstances=m}function Xf(i){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(t.calls++,a){case i.TRIANGLES:t.triangles+=o*(r/3);break;case i.LINES:t.lines+=o*(r/2);break;case i.LINE_STRIP:t.lines+=o*(r-1);break;case i.LINE_LOOP:t.lines+=o*r;break;case i.POINTS:t.points+=o*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",a);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function Yf(i,e,t){const n=new WeakMap,s=new ct;function r(a,o,l){const c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,m=h!==void 0?h.length:0;let p=n.get(o);if(p===void 0||p.count!==m){let g=function(){B.dispose(),n.delete(o),o.removeEventListener("dispose",g)};var u=g;p!==void 0&&p.texture.dispose();const _=o.morphAttributes.position!==void 0,M=o.morphAttributes.normal!==void 0,f=o.morphAttributes.color!==void 0,d=o.morphAttributes.position||[],E=o.morphAttributes.normal||[],S=o.morphAttributes.color||[];let T=0;_===!0&&(T=1),M===!0&&(T=2),f===!0&&(T=3);let z=o.attributes.position.count*T,D=1;z>e.maxTextureSize&&(D=Math.ceil(z/e.maxTextureSize),z=e.maxTextureSize);const A=new Float32Array(z*D*4*m),B=new ec(A,z,D,m);B.type=un,B.needsUpdate=!0;const ie=T*4;for(let y=0;y<m;y++){const W=d[y],H=E[y],Q=S[y],re=z*D*4*y;for(let Y=0;Y<W.count;Y++){const ne=Y*ie;_===!0&&(s.fromBufferAttribute(W,Y),A[re+ne+0]=s.x,A[re+ne+1]=s.y,A[re+ne+2]=s.z,A[re+ne+3]=0),M===!0&&(s.fromBufferAttribute(H,Y),A[re+ne+4]=s.x,A[re+ne+5]=s.y,A[re+ne+6]=s.z,A[re+ne+7]=0),f===!0&&(s.fromBufferAttribute(Q,Y),A[re+ne+8]=s.x,A[re+ne+9]=s.y,A[re+ne+10]=s.z,A[re+ne+11]=Q.itemSize===4?s.w:1)}}p={count:m,texture:B,size:new Ue(z,D)},n.set(o,p),o.addEventListener("dispose",g)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",a.morphTexture,t);else{let _=0;for(let f=0;f<c.length;f++)_+=c[f];const M=o.morphTargetsRelative?1:1-_;l.getUniforms().setValue(i,"morphTargetBaseInfluence",M),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",p.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",p.size)}return{update:r}}function qf(i,e,t,n){let s=new WeakMap;function r(l){const c=n.render.frame,h=l.geometry,m=e.get(l,h);if(s.get(m)!==c&&(e.update(m),s.set(m,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",o)===!1&&l.addEventListener("dispose",o),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){const p=l.skeleton;s.get(p)!==c&&(p.update(),s.set(p,c))}return m}function a(){s=new WeakMap}function o(l){const c=l.target;c.removeEventListener("dispose",o),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:a}}class cc extends Rt{constructor(e,t,n,s,r,a,o,l,c,h=Mi){if(h!==Mi&&h!==Ri)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===Mi&&(n=Yn),n===void 0&&h===Ri&&(n=wi),super(null,s,r,a,o,l,h,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=o!==void 0?o:zt,this.minFilter=l!==void 0?l:zt,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}const hc=new Rt,Xo=new cc(1,1),uc=new ec,dc=new Dh,fc=new ac,Yo=[],qo=[],jo=new Float32Array(16),Ko=new Float32Array(9),$o=new Float32Array(4);function Li(i,e,t){const n=i[0];if(n<=0||n>0)return i;const s=e*t;let r=Yo[s];if(r===void 0&&(r=new Float32Array(s),Yo[s]=r),e!==0){n.toArray(r,0);for(let a=1,o=0;a!==e;++a)o+=t,i[a].toArray(r,o)}return r}function pt(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function mt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function sr(i,e){let t=qo[e];t===void 0&&(t=new Int32Array(e),qo[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function jf(i,e){const t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function Kf(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(pt(t,e))return;i.uniform2fv(this.addr,e),mt(t,e)}}function $f(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(pt(t,e))return;i.uniform3fv(this.addr,e),mt(t,e)}}function Zf(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(pt(t,e))return;i.uniform4fv(this.addr,e),mt(t,e)}}function Jf(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(pt(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),mt(t,e)}else{if(pt(t,n))return;$o.set(n),i.uniformMatrix2fv(this.addr,!1,$o),mt(t,n)}}function Qf(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(pt(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),mt(t,e)}else{if(pt(t,n))return;Ko.set(n),i.uniformMatrix3fv(this.addr,!1,Ko),mt(t,n)}}function ep(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(pt(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),mt(t,e)}else{if(pt(t,n))return;jo.set(n),i.uniformMatrix4fv(this.addr,!1,jo),mt(t,n)}}function tp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function np(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(pt(t,e))return;i.uniform2iv(this.addr,e),mt(t,e)}}function ip(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(pt(t,e))return;i.uniform3iv(this.addr,e),mt(t,e)}}function sp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(pt(t,e))return;i.uniform4iv(this.addr,e),mt(t,e)}}function rp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function ap(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(pt(t,e))return;i.uniform2uiv(this.addr,e),mt(t,e)}}function op(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(pt(t,e))return;i.uniform3uiv(this.addr,e),mt(t,e)}}function lp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(pt(t,e))return;i.uniform4uiv(this.addr,e),mt(t,e)}}function cp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(Xo.compareFunction=Zl,r=Xo):r=hc,t.setTexture2D(e||r,s)}function hp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||dc,s)}function up(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||fc,s)}function dp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||uc,s)}function fp(i){switch(i){case 5126:return jf;case 35664:return Kf;case 35665:return $f;case 35666:return Zf;case 35674:return Jf;case 35675:return Qf;case 35676:return ep;case 5124:case 35670:return tp;case 35667:case 35671:return np;case 35668:case 35672:return ip;case 35669:case 35673:return sp;case 5125:return rp;case 36294:return ap;case 36295:return op;case 36296:return lp;case 35678:case 36198:case 36298:case 36306:case 35682:return cp;case 35679:case 36299:case 36307:return hp;case 35680:case 36300:case 36308:case 36293:return up;case 36289:case 36303:case 36311:case 36292:return dp}}function pp(i,e){i.uniform1fv(this.addr,e)}function mp(i,e){const t=Li(e,this.size,2);i.uniform2fv(this.addr,t)}function _p(i,e){const t=Li(e,this.size,3);i.uniform3fv(this.addr,t)}function gp(i,e){const t=Li(e,this.size,4);i.uniform4fv(this.addr,t)}function vp(i,e){const t=Li(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function xp(i,e){const t=Li(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function Mp(i,e){const t=Li(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function Sp(i,e){i.uniform1iv(this.addr,e)}function yp(i,e){i.uniform2iv(this.addr,e)}function Ep(i,e){i.uniform3iv(this.addr,e)}function bp(i,e){i.uniform4iv(this.addr,e)}function Tp(i,e){i.uniform1uiv(this.addr,e)}function Ap(i,e){i.uniform2uiv(this.addr,e)}function wp(i,e){i.uniform3uiv(this.addr,e)}function Rp(i,e){i.uniform4uiv(this.addr,e)}function Cp(i,e,t){const n=this.cache,s=e.length,r=sr(t,s);pt(n,r)||(i.uniform1iv(this.addr,r),mt(n,r));for(let a=0;a!==s;++a)t.setTexture2D(e[a]||hc,r[a])}function Pp(i,e,t){const n=this.cache,s=e.length,r=sr(t,s);pt(n,r)||(i.uniform1iv(this.addr,r),mt(n,r));for(let a=0;a!==s;++a)t.setTexture3D(e[a]||dc,r[a])}function Lp(i,e,t){const n=this.cache,s=e.length,r=sr(t,s);pt(n,r)||(i.uniform1iv(this.addr,r),mt(n,r));for(let a=0;a!==s;++a)t.setTextureCube(e[a]||fc,r[a])}function Dp(i,e,t){const n=this.cache,s=e.length,r=sr(t,s);pt(n,r)||(i.uniform1iv(this.addr,r),mt(n,r));for(let a=0;a!==s;++a)t.setTexture2DArray(e[a]||uc,r[a])}function Ip(i){switch(i){case 5126:return pp;case 35664:return mp;case 35665:return _p;case 35666:return gp;case 35674:return vp;case 35675:return xp;case 35676:return Mp;case 5124:case 35670:return Sp;case 35667:case 35671:return yp;case 35668:case 35672:return Ep;case 35669:case 35673:return bp;case 5125:return Tp;case 36294:return Ap;case 36295:return wp;case 36296:return Rp;case 35678:case 36198:case 36298:case 36306:case 35682:return Cp;case 35679:case 36299:case 36307:return Pp;case 35680:case 36300:case 36308:case 36293:return Lp;case 36289:case 36303:case 36311:case 36292:return Dp}}class Np{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=fp(t.type)}}class Up{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Ip(t.type)}}class Fp{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const s=this.seq;for(let r=0,a=s.length;r!==a;++r){const o=s[r];o.setValue(e,t[o.id],n)}}}const Hr=/(\w+)(\])?(\[|\.)?/g;function Zo(i,e){i.seq.push(e),i.map[e.id]=e}function Op(i,e,t){const n=i.name,s=n.length;for(Hr.lastIndex=0;;){const r=Hr.exec(n),a=Hr.lastIndex;let o=r[1];const l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===s){Zo(t,c===void 0?new Np(o,i,e):new Up(o,i,e));break}else{let m=t.map[o];m===void 0&&(m=new Fp(o),Zo(t,m)),t=m}}}class Bs{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){const r=e.getActiveUniform(t,s),a=e.getUniformLocation(t,r.name);Op(r,a,this)}}setValue(e,t,n,s){const r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){const s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,a=t.length;r!==a;++r){const o=t[r],l=n[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,s)}}static seqWithValue(e,t){const n=[];for(let s=0,r=e.length;s!==r;++s){const a=e[s];a.id in t&&n.push(a)}return n}}function Jo(i,e,t){const n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}const Bp=37297;let zp=0;function kp(i,e){const t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let a=s;a<r;a++){const o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}function Hp(i){const e=et.getPrimaries(et.workingColorSpace),t=et.getPrimaries(i);let n;switch(e===t?n="":e===Vs&&t===Gs?n="LinearDisplayP3ToLinearSRGB":e===Gs&&t===Vs&&(n="LinearSRGBToLinearDisplayP3"),i){case In:case er:return[n,"LinearTransferOETF"];case Zt:case $a:return[n,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",i),[n,"LinearTransferOETF"]}}function Qo(i,e,t){const n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";const r=/ERROR: 0:(\d+)/.exec(s);if(r){const a=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+kp(i.getShaderSource(e),a)}else return s}function Gp(i,e){const t=Hp(e);return`vec4 ${i}( vec4 value ) { return ${t[0]}( ${t[1]}( value ) ); }`}function Vp(i,e){let t;switch(e){case ih:t="Linear";break;case sh:t="Reinhard";break;case rh:t="Cineon";break;case ah:t="ACESFilmic";break;case lh:t="AgX";break;case ch:t="Neutral";break;case oh:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const bs=new O;function Wp(){et.getLuminanceCoefficients(bs);const i=bs.x.toFixed(4),e=bs.y.toFixed(4),t=bs.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Xp(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Gi).join(`
`)}function Yp(i){const e=[];for(const t in i){const n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function qp(i,e){const t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){const r=i.getActiveAttrib(e,s),a=r.name;let o=1;r.type===i.FLOAT_MAT2&&(o=2),r.type===i.FLOAT_MAT3&&(o=3),r.type===i.FLOAT_MAT4&&(o=4),t[a]={type:r.type,location:i.getAttribLocation(e,a),locationSize:o}}return t}function Gi(i){return i!==""}function el(i,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function tl(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const jp=/^[ \t]*#include +<([\w\d./]+)>/gm;function za(i){return i.replace(jp,$p)}const Kp=new Map;function $p(i,e){let t=He[e];if(t===void 0){const n=Kp.get(e);if(n!==void 0)t=He[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return za(t)}const Zp=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function nl(i){return i.replace(Zp,Jp)}function Jp(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function il(i){let e=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function Qp(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===Ol?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===Fc?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===cn&&(e="SHADOWMAP_TYPE_VSM"),e}function em(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case Ti:case Ai:e="ENVMAP_TYPE_CUBE";break;case Qs:e="ENVMAP_TYPE_CUBE_UV";break}return e}function tm(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Ai:e="ENVMAP_MODE_REFRACTION";break}return e}function nm(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case Bl:e="ENVMAP_BLENDING_MULTIPLY";break;case th:e="ENVMAP_BLENDING_MIX";break;case nh:e="ENVMAP_BLENDING_ADD";break}return e}function im(i){const e=i.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function sm(i,e,t,n){const s=i.getContext(),r=t.defines;let a=t.vertexShader,o=t.fragmentShader;const l=Qp(t),c=em(t),h=tm(t),m=nm(t),p=im(t),u=Xp(t),_=Yp(r),M=s.createProgram();let f,d,E=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(f=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(Gi).join(`
`),f.length>0&&(f+=`
`),d=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(Gi).join(`
`),d.length>0&&(d+=`
`)):(f=[il(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Gi).join(`
`),d=[il(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+m:"",p?"#define CUBEUV_TEXEL_WIDTH "+p.texelWidth:"",p?"#define CUBEUV_TEXEL_HEIGHT "+p.texelHeight:"",p?"#define CUBEUV_MAX_MIP "+p.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Pn?"#define TONE_MAPPING":"",t.toneMapping!==Pn?He.tonemapping_pars_fragment:"",t.toneMapping!==Pn?Vp("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",He.colorspace_pars_fragment,Gp("linearToOutputTexel",t.outputColorSpace),Wp(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(Gi).join(`
`)),a=za(a),a=el(a,t),a=tl(a,t),o=za(o),o=el(o,t),o=tl(o,t),a=nl(a),o=nl(o),t.isRawShaderMaterial!==!0&&(E=`#version 300 es
`,f=[u,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+f,d=["#define varying in",t.glslVersion===Mo?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Mo?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+d);const S=E+f+a,T=E+d+o,z=Jo(s,s.VERTEX_SHADER,S),D=Jo(s,s.FRAGMENT_SHADER,T);s.attachShader(M,z),s.attachShader(M,D),t.index0AttributeName!==void 0?s.bindAttribLocation(M,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(M,0,"position"),s.linkProgram(M);function A(y){if(i.debug.checkShaderErrors){const W=s.getProgramInfoLog(M).trim(),H=s.getShaderInfoLog(z).trim(),Q=s.getShaderInfoLog(D).trim();let re=!0,Y=!0;if(s.getProgramParameter(M,s.LINK_STATUS)===!1)if(re=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,M,z,D);else{const ne=Qo(s,z,"vertex"),V=Qo(s,D,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(M,s.VALIDATE_STATUS)+`

Material Name: `+y.name+`
Material Type: `+y.type+`

Program Info Log: `+W+`
`+ne+`
`+V)}else W!==""?console.warn("THREE.WebGLProgram: Program Info Log:",W):(H===""||Q==="")&&(Y=!1);Y&&(y.diagnostics={runnable:re,programLog:W,vertexShader:{log:H,prefix:f},fragmentShader:{log:Q,prefix:d}})}s.deleteShader(z),s.deleteShader(D),B=new Bs(s,M),ie=qp(s,M)}let B;this.getUniforms=function(){return B===void 0&&A(this),B};let ie;this.getAttributes=function(){return ie===void 0&&A(this),ie};let g=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return g===!1&&(g=s.getProgramParameter(M,Bp)),g},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(M),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=zp++,this.cacheKey=e,this.usedTimes=1,this.program=M,this.vertexShader=z,this.fragmentShader=D,this}let rm=0;class am{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),a=this._getShaderCacheForMaterial(e);return a.has(s)===!1&&(a.add(s),s.usedTimes++),a.has(r)===!1&&(a.add(r),r.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new om(e),t.set(e,n)),n}}class om{constructor(e){this.id=rm++,this.code=e,this.usedTimes=0}}function lm(i,e,t,n,s,r,a){const o=new Za,l=new am,c=new Set,h=[],m=s.logarithmicDepthBuffer,p=s.reverseDepthBuffer,u=s.vertexTextures;let _=s.precision;const M={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function f(g){return c.add(g),g===0?"uv":`uv${g}`}function d(g,y,W,H,Q){const re=H.fog,Y=Q.geometry,ne=g.isMeshStandardMaterial?H.environment:null,V=(g.isMeshStandardMaterial?t:e).get(g.envMap||ne),ve=V&&V.mapping===Qs?V.image.height:null,Me=M[g.type];g.precision!==null&&(_=s.getMaxPrecision(g.precision),_!==g.precision&&console.warn("THREE.WebGLProgram.getParameters:",g.precision,"not supported, using",_,"instead."));const ye=Y.morphAttributes.position||Y.morphAttributes.normal||Y.morphAttributes.color,ze=ye!==void 0?ye.length:0;let Be=0;Y.morphAttributes.position!==void 0&&(Be=1),Y.morphAttributes.normal!==void 0&&(Be=2),Y.morphAttributes.color!==void 0&&(Be=3);let j,ae,Ee,Se;if(Me){const dt=Jt[Me];j=dt.vertexShader,ae=dt.fragmentShader}else j=g.vertexShader,ae=g.fragmentShader,l.update(g),Ee=l.getVertexShaderID(g),Se=l.getFragmentShaderID(g);const Oe=i.getRenderTarget(),Le=Q.isInstancedMesh===!0,qe=Q.isBatchedMesh===!0,$e=!!g.map,We=!!g.matcap,P=!!V,vt=!!g.aoMap,Ve=!!g.lightMap,je=!!g.bumpMap,De=!!g.normalMap,tt=!!g.displacementMap,Ne=!!g.emissiveMap,b=!!g.metalnessMap,x=!!g.roughnessMap,k=g.anisotropy>0,q=g.clearcoat>0,se=g.dispersion>0,Z=g.iridescence>0,be=g.sheen>0,he=g.transmission>0,xe=k&&!!g.anisotropyMap,Fe=q&&!!g.clearcoatMap,oe=q&&!!g.clearcoatNormalMap,fe=q&&!!g.clearcoatRoughnessMap,Pe=Z&&!!g.iridescenceMap,Ae=Z&&!!g.iridescenceThicknessMap,pe=be&&!!g.sheenColorMap,ke=be&&!!g.sheenRoughnessMap,Ie=!!g.specularMap,nt=!!g.specularColorMap,N=!!g.specularIntensityMap,me=he&&!!g.transmissionMap,G=he&&!!g.thicknessMap,te=!!g.gradientMap,de=!!g.alphaMap,_e=g.alphaTest>0,Xe=!!g.alphaHash,ot=!!g.extensions;let Mt=Pn;g.toneMapped&&(Oe===null||Oe.isXRRenderTarget===!0)&&(Mt=i.toneMapping);const Ke={shaderID:Me,shaderType:g.type,shaderName:g.name,vertexShader:j,fragmentShader:ae,defines:g.defines,customVertexShaderID:Ee,customFragmentShaderID:Se,isRawShaderMaterial:g.isRawShaderMaterial===!0,glslVersion:g.glslVersion,precision:_,batching:qe,batchingColor:qe&&Q._colorsTexture!==null,instancing:Le,instancingColor:Le&&Q.instanceColor!==null,instancingMorph:Le&&Q.morphTexture!==null,supportsVertexTextures:u,outputColorSpace:Oe===null?i.outputColorSpace:Oe.isXRRenderTarget===!0?Oe.texture.colorSpace:In,alphaToCoverage:!!g.alphaToCoverage,map:$e,matcap:We,envMap:P,envMapMode:P&&V.mapping,envMapCubeUVHeight:ve,aoMap:vt,lightMap:Ve,bumpMap:je,normalMap:De,displacementMap:u&&tt,emissiveMap:Ne,normalMapObjectSpace:De&&g.normalMapType===fh,normalMapTangentSpace:De&&g.normalMapType===$l,metalnessMap:b,roughnessMap:x,anisotropy:k,anisotropyMap:xe,clearcoat:q,clearcoatMap:Fe,clearcoatNormalMap:oe,clearcoatRoughnessMap:fe,dispersion:se,iridescence:Z,iridescenceMap:Pe,iridescenceThicknessMap:Ae,sheen:be,sheenColorMap:pe,sheenRoughnessMap:ke,specularMap:Ie,specularColorMap:nt,specularIntensityMap:N,transmission:he,transmissionMap:me,thicknessMap:G,gradientMap:te,opaque:g.transparent===!1&&g.blending===xi&&g.alphaToCoverage===!1,alphaMap:de,alphaTest:_e,alphaHash:Xe,combine:g.combine,mapUv:$e&&f(g.map.channel),aoMapUv:vt&&f(g.aoMap.channel),lightMapUv:Ve&&f(g.lightMap.channel),bumpMapUv:je&&f(g.bumpMap.channel),normalMapUv:De&&f(g.normalMap.channel),displacementMapUv:tt&&f(g.displacementMap.channel),emissiveMapUv:Ne&&f(g.emissiveMap.channel),metalnessMapUv:b&&f(g.metalnessMap.channel),roughnessMapUv:x&&f(g.roughnessMap.channel),anisotropyMapUv:xe&&f(g.anisotropyMap.channel),clearcoatMapUv:Fe&&f(g.clearcoatMap.channel),clearcoatNormalMapUv:oe&&f(g.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:fe&&f(g.clearcoatRoughnessMap.channel),iridescenceMapUv:Pe&&f(g.iridescenceMap.channel),iridescenceThicknessMapUv:Ae&&f(g.iridescenceThicknessMap.channel),sheenColorMapUv:pe&&f(g.sheenColorMap.channel),sheenRoughnessMapUv:ke&&f(g.sheenRoughnessMap.channel),specularMapUv:Ie&&f(g.specularMap.channel),specularColorMapUv:nt&&f(g.specularColorMap.channel),specularIntensityMapUv:N&&f(g.specularIntensityMap.channel),transmissionMapUv:me&&f(g.transmissionMap.channel),thicknessMapUv:G&&f(g.thicknessMap.channel),alphaMapUv:de&&f(g.alphaMap.channel),vertexTangents:!!Y.attributes.tangent&&(De||k),vertexColors:g.vertexColors,vertexAlphas:g.vertexColors===!0&&!!Y.attributes.color&&Y.attributes.color.itemSize===4,pointsUvs:Q.isPoints===!0&&!!Y.attributes.uv&&($e||de),fog:!!re,useFog:g.fog===!0,fogExp2:!!re&&re.isFogExp2,flatShading:g.flatShading===!0,sizeAttenuation:g.sizeAttenuation===!0,logarithmicDepthBuffer:m,reverseDepthBuffer:p,skinning:Q.isSkinnedMesh===!0,morphTargets:Y.morphAttributes.position!==void 0,morphNormals:Y.morphAttributes.normal!==void 0,morphColors:Y.morphAttributes.color!==void 0,morphTargetsCount:ze,morphTextureStride:Be,numDirLights:y.directional.length,numPointLights:y.point.length,numSpotLights:y.spot.length,numSpotLightMaps:y.spotLightMap.length,numRectAreaLights:y.rectArea.length,numHemiLights:y.hemi.length,numDirLightShadows:y.directionalShadowMap.length,numPointLightShadows:y.pointShadowMap.length,numSpotLightShadows:y.spotShadowMap.length,numSpotLightShadowsWithMaps:y.numSpotLightShadowsWithMaps,numLightProbes:y.numLightProbes,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:g.dithering,shadowMapEnabled:i.shadowMap.enabled&&W.length>0,shadowMapType:i.shadowMap.type,toneMapping:Mt,decodeVideoTexture:$e&&g.map.isVideoTexture===!0&&et.getTransfer(g.map.colorSpace)===at,premultipliedAlpha:g.premultipliedAlpha,doubleSided:g.side===hn,flipSided:g.side===wt,useDepthPacking:g.depthPacking>=0,depthPacking:g.depthPacking||0,index0AttributeName:g.index0AttributeName,extensionClipCullDistance:ot&&g.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ot&&g.extensions.multiDraw===!0||qe)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:g.customProgramCacheKey()};return Ke.vertexUv1s=c.has(1),Ke.vertexUv2s=c.has(2),Ke.vertexUv3s=c.has(3),c.clear(),Ke}function E(g){const y=[];if(g.shaderID?y.push(g.shaderID):(y.push(g.customVertexShaderID),y.push(g.customFragmentShaderID)),g.defines!==void 0)for(const W in g.defines)y.push(W),y.push(g.defines[W]);return g.isRawShaderMaterial===!1&&(S(y,g),T(y,g),y.push(i.outputColorSpace)),y.push(g.customProgramCacheKey),y.join()}function S(g,y){g.push(y.precision),g.push(y.outputColorSpace),g.push(y.envMapMode),g.push(y.envMapCubeUVHeight),g.push(y.mapUv),g.push(y.alphaMapUv),g.push(y.lightMapUv),g.push(y.aoMapUv),g.push(y.bumpMapUv),g.push(y.normalMapUv),g.push(y.displacementMapUv),g.push(y.emissiveMapUv),g.push(y.metalnessMapUv),g.push(y.roughnessMapUv),g.push(y.anisotropyMapUv),g.push(y.clearcoatMapUv),g.push(y.clearcoatNormalMapUv),g.push(y.clearcoatRoughnessMapUv),g.push(y.iridescenceMapUv),g.push(y.iridescenceThicknessMapUv),g.push(y.sheenColorMapUv),g.push(y.sheenRoughnessMapUv),g.push(y.specularMapUv),g.push(y.specularColorMapUv),g.push(y.specularIntensityMapUv),g.push(y.transmissionMapUv),g.push(y.thicknessMapUv),g.push(y.combine),g.push(y.fogExp2),g.push(y.sizeAttenuation),g.push(y.morphTargetsCount),g.push(y.morphAttributeCount),g.push(y.numDirLights),g.push(y.numPointLights),g.push(y.numSpotLights),g.push(y.numSpotLightMaps),g.push(y.numHemiLights),g.push(y.numRectAreaLights),g.push(y.numDirLightShadows),g.push(y.numPointLightShadows),g.push(y.numSpotLightShadows),g.push(y.numSpotLightShadowsWithMaps),g.push(y.numLightProbes),g.push(y.shadowMapType),g.push(y.toneMapping),g.push(y.numClippingPlanes),g.push(y.numClipIntersection),g.push(y.depthPacking)}function T(g,y){o.disableAll(),y.supportsVertexTextures&&o.enable(0),y.instancing&&o.enable(1),y.instancingColor&&o.enable(2),y.instancingMorph&&o.enable(3),y.matcap&&o.enable(4),y.envMap&&o.enable(5),y.normalMapObjectSpace&&o.enable(6),y.normalMapTangentSpace&&o.enable(7),y.clearcoat&&o.enable(8),y.iridescence&&o.enable(9),y.alphaTest&&o.enable(10),y.vertexColors&&o.enable(11),y.vertexAlphas&&o.enable(12),y.vertexUv1s&&o.enable(13),y.vertexUv2s&&o.enable(14),y.vertexUv3s&&o.enable(15),y.vertexTangents&&o.enable(16),y.anisotropy&&o.enable(17),y.alphaHash&&o.enable(18),y.batching&&o.enable(19),y.dispersion&&o.enable(20),y.batchingColor&&o.enable(21),g.push(o.mask),o.disableAll(),y.fog&&o.enable(0),y.useFog&&o.enable(1),y.flatShading&&o.enable(2),y.logarithmicDepthBuffer&&o.enable(3),y.reverseDepthBuffer&&o.enable(4),y.skinning&&o.enable(5),y.morphTargets&&o.enable(6),y.morphNormals&&o.enable(7),y.morphColors&&o.enable(8),y.premultipliedAlpha&&o.enable(9),y.shadowMapEnabled&&o.enable(10),y.doubleSided&&o.enable(11),y.flipSided&&o.enable(12),y.useDepthPacking&&o.enable(13),y.dithering&&o.enable(14),y.transmission&&o.enable(15),y.sheen&&o.enable(16),y.opaque&&o.enable(17),y.pointsUvs&&o.enable(18),y.decodeVideoTexture&&o.enable(19),y.alphaToCoverage&&o.enable(20),g.push(o.mask)}function z(g){const y=M[g.type];let W;if(y){const H=Jt[y];W=Wh.clone(H.uniforms)}else W=g.uniforms;return W}function D(g,y){let W;for(let H=0,Q=h.length;H<Q;H++){const re=h[H];if(re.cacheKey===y){W=re,++W.usedTimes;break}}return W===void 0&&(W=new sm(i,y,g,r),h.push(W)),W}function A(g){if(--g.usedTimes===0){const y=h.indexOf(g);h[y]=h[h.length-1],h.pop(),g.destroy()}}function B(g){l.remove(g)}function ie(){l.dispose()}return{getParameters:d,getProgramCacheKey:E,getUniforms:z,acquireProgram:D,releaseProgram:A,releaseShaderCache:B,programs:h,dispose:ie}}function cm(){let i=new WeakMap;function e(a){return i.has(a)}function t(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function s(a,o,l){i.get(a)[o]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function hm(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function sl(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function rl(){const i=[];let e=0;const t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function a(m,p,u,_,M,f){let d=i[e];return d===void 0?(d={id:m.id,object:m,geometry:p,material:u,groupOrder:_,renderOrder:m.renderOrder,z:M,group:f},i[e]=d):(d.id=m.id,d.object=m,d.geometry=p,d.material=u,d.groupOrder=_,d.renderOrder=m.renderOrder,d.z=M,d.group=f),e++,d}function o(m,p,u,_,M,f){const d=a(m,p,u,_,M,f);u.transmission>0?n.push(d):u.transparent===!0?s.push(d):t.push(d)}function l(m,p,u,_,M,f){const d=a(m,p,u,_,M,f);u.transmission>0?n.unshift(d):u.transparent===!0?s.unshift(d):t.unshift(d)}function c(m,p){t.length>1&&t.sort(m||hm),n.length>1&&n.sort(p||sl),s.length>1&&s.sort(p||sl)}function h(){for(let m=e,p=i.length;m<p;m++){const u=i[m];if(u.id===null)break;u.id=null,u.object=null,u.geometry=null,u.material=null,u.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:o,unshift:l,finish:h,sort:c}}function um(){let i=new WeakMap;function e(n,s){const r=i.get(n);let a;return r===void 0?(a=new rl,i.set(n,[a])):s>=r.length?(a=new rl,r.push(a)):a=r[s],a}function t(){i=new WeakMap}return{get:e,dispose:t}}function dm(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new O,color:new Ye};break;case"SpotLight":t={position:new O,direction:new O,color:new Ye,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new O,color:new Ye,distance:0,decay:0};break;case"HemisphereLight":t={direction:new O,skyColor:new Ye,groundColor:new Ye};break;case"RectAreaLight":t={color:new Ye,position:new O,halfWidth:new O,halfHeight:new O};break}return i[e.id]=t,t}}}function fm(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ue};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ue};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ue,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}let pm=0;function mm(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function _m(i){const e=new dm,t=fm(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new O);const s=new O,r=new st,a=new st;function o(c){let h=0,m=0,p=0;for(let ie=0;ie<9;ie++)n.probe[ie].set(0,0,0);let u=0,_=0,M=0,f=0,d=0,E=0,S=0,T=0,z=0,D=0,A=0;c.sort(mm);for(let ie=0,g=c.length;ie<g;ie++){const y=c[ie],W=y.color,H=y.intensity,Q=y.distance,re=y.shadow&&y.shadow.map?y.shadow.map.texture:null;if(y.isAmbientLight)h+=W.r*H,m+=W.g*H,p+=W.b*H;else if(y.isLightProbe){for(let Y=0;Y<9;Y++)n.probe[Y].addScaledVector(y.sh.coefficients[Y],H);A++}else if(y.isDirectionalLight){const Y=e.get(y);if(Y.color.copy(y.color).multiplyScalar(y.intensity),y.castShadow){const ne=y.shadow,V=t.get(y);V.shadowIntensity=ne.intensity,V.shadowBias=ne.bias,V.shadowNormalBias=ne.normalBias,V.shadowRadius=ne.radius,V.shadowMapSize=ne.mapSize,n.directionalShadow[u]=V,n.directionalShadowMap[u]=re,n.directionalShadowMatrix[u]=y.shadow.matrix,E++}n.directional[u]=Y,u++}else if(y.isSpotLight){const Y=e.get(y);Y.position.setFromMatrixPosition(y.matrixWorld),Y.color.copy(W).multiplyScalar(H),Y.distance=Q,Y.coneCos=Math.cos(y.angle),Y.penumbraCos=Math.cos(y.angle*(1-y.penumbra)),Y.decay=y.decay,n.spot[M]=Y;const ne=y.shadow;if(y.map&&(n.spotLightMap[z]=y.map,z++,ne.updateMatrices(y),y.castShadow&&D++),n.spotLightMatrix[M]=ne.matrix,y.castShadow){const V=t.get(y);V.shadowIntensity=ne.intensity,V.shadowBias=ne.bias,V.shadowNormalBias=ne.normalBias,V.shadowRadius=ne.radius,V.shadowMapSize=ne.mapSize,n.spotShadow[M]=V,n.spotShadowMap[M]=re,T++}M++}else if(y.isRectAreaLight){const Y=e.get(y);Y.color.copy(W).multiplyScalar(H),Y.halfWidth.set(y.width*.5,0,0),Y.halfHeight.set(0,y.height*.5,0),n.rectArea[f]=Y,f++}else if(y.isPointLight){const Y=e.get(y);if(Y.color.copy(y.color).multiplyScalar(y.intensity),Y.distance=y.distance,Y.decay=y.decay,y.castShadow){const ne=y.shadow,V=t.get(y);V.shadowIntensity=ne.intensity,V.shadowBias=ne.bias,V.shadowNormalBias=ne.normalBias,V.shadowRadius=ne.radius,V.shadowMapSize=ne.mapSize,V.shadowCameraNear=ne.camera.near,V.shadowCameraFar=ne.camera.far,n.pointShadow[_]=V,n.pointShadowMap[_]=re,n.pointShadowMatrix[_]=y.shadow.matrix,S++}n.point[_]=Y,_++}else if(y.isHemisphereLight){const Y=e.get(y);Y.skyColor.copy(y.color).multiplyScalar(H),Y.groundColor.copy(y.groundColor).multiplyScalar(H),n.hemi[d]=Y,d++}}f>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=ue.LTC_FLOAT_1,n.rectAreaLTC2=ue.LTC_FLOAT_2):(n.rectAreaLTC1=ue.LTC_HALF_1,n.rectAreaLTC2=ue.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=m,n.ambient[2]=p;const B=n.hash;(B.directionalLength!==u||B.pointLength!==_||B.spotLength!==M||B.rectAreaLength!==f||B.hemiLength!==d||B.numDirectionalShadows!==E||B.numPointShadows!==S||B.numSpotShadows!==T||B.numSpotMaps!==z||B.numLightProbes!==A)&&(n.directional.length=u,n.spot.length=M,n.rectArea.length=f,n.point.length=_,n.hemi.length=d,n.directionalShadow.length=E,n.directionalShadowMap.length=E,n.pointShadow.length=S,n.pointShadowMap.length=S,n.spotShadow.length=T,n.spotShadowMap.length=T,n.directionalShadowMatrix.length=E,n.pointShadowMatrix.length=S,n.spotLightMatrix.length=T+z-D,n.spotLightMap.length=z,n.numSpotLightShadowsWithMaps=D,n.numLightProbes=A,B.directionalLength=u,B.pointLength=_,B.spotLength=M,B.rectAreaLength=f,B.hemiLength=d,B.numDirectionalShadows=E,B.numPointShadows=S,B.numSpotShadows=T,B.numSpotMaps=z,B.numLightProbes=A,n.version=pm++)}function l(c,h){let m=0,p=0,u=0,_=0,M=0;const f=h.matrixWorldInverse;for(let d=0,E=c.length;d<E;d++){const S=c[d];if(S.isDirectionalLight){const T=n.directional[m];T.direction.setFromMatrixPosition(S.matrixWorld),s.setFromMatrixPosition(S.target.matrixWorld),T.direction.sub(s),T.direction.transformDirection(f),m++}else if(S.isSpotLight){const T=n.spot[u];T.position.setFromMatrixPosition(S.matrixWorld),T.position.applyMatrix4(f),T.direction.setFromMatrixPosition(S.matrixWorld),s.setFromMatrixPosition(S.target.matrixWorld),T.direction.sub(s),T.direction.transformDirection(f),u++}else if(S.isRectAreaLight){const T=n.rectArea[_];T.position.setFromMatrixPosition(S.matrixWorld),T.position.applyMatrix4(f),a.identity(),r.copy(S.matrixWorld),r.premultiply(f),a.extractRotation(r),T.halfWidth.set(S.width*.5,0,0),T.halfHeight.set(0,S.height*.5,0),T.halfWidth.applyMatrix4(a),T.halfHeight.applyMatrix4(a),_++}else if(S.isPointLight){const T=n.point[p];T.position.setFromMatrixPosition(S.matrixWorld),T.position.applyMatrix4(f),p++}else if(S.isHemisphereLight){const T=n.hemi[M];T.direction.setFromMatrixPosition(S.matrixWorld),T.direction.transformDirection(f),M++}}}return{setup:o,setupView:l,state:n}}function al(i){const e=new _m(i),t=[],n=[];function s(h){c.camera=h,t.length=0,n.length=0}function r(h){t.push(h)}function a(h){n.push(h)}function o(){e.setup(t)}function l(h){e.setupView(t,h)}const c={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:s,state:c,setupLights:o,setupLightsView:l,pushLight:r,pushShadow:a}}function gm(i){let e=new WeakMap;function t(s,r=0){const a=e.get(s);let o;return a===void 0?(o=new al(i),e.set(s,[o])):r>=a.length?(o=new al(i),a.push(o)):o=a[r],o}function n(){e=new WeakMap}return{get:t,dispose:n}}class vm extends Zn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=uh,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class xm extends Zn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}const Mm=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Sm=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function ym(i,e,t){let n=new Qa;const s=new Ue,r=new Ue,a=new ct,o=new vm({depthPacking:dh}),l=new xm,c={},h=t.maxTextureSize,m={[Ln]:wt,[wt]:Ln,[hn]:hn},p=new Dn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ue},radius:{value:4}},vertexShader:Mm,fragmentShader:Sm}),u=p.clone();u.defines.HORIZONTAL_PASS=1;const _=new Ut;_.setAttribute("position",new en(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const M=new kt(_,p),f=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Ol;let d=this.type;this.render=function(D,A,B){if(f.enabled===!1||f.autoUpdate===!1&&f.needsUpdate===!1||D.length===0)return;const ie=i.getRenderTarget(),g=i.getActiveCubeFace(),y=i.getActiveMipmapLevel(),W=i.state;W.setBlending(Cn),W.buffers.color.setClear(1,1,1,1),W.buffers.depth.setTest(!0),W.setScissorTest(!1);const H=d!==cn&&this.type===cn,Q=d===cn&&this.type!==cn;for(let re=0,Y=D.length;re<Y;re++){const ne=D[re],V=ne.shadow;if(V===void 0){console.warn("THREE.WebGLShadowMap:",ne,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;s.copy(V.mapSize);const ve=V.getFrameExtents();if(s.multiply(ve),r.copy(V.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/ve.x),s.x=r.x*ve.x,V.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/ve.y),s.y=r.y*ve.y,V.mapSize.y=r.y)),V.map===null||H===!0||Q===!0){const ye=this.type!==cn?{minFilter:zt,magFilter:zt}:{};V.map!==null&&V.map.dispose(),V.map=new qn(s.x,s.y,ye),V.map.texture.name=ne.name+".shadowMap",V.camera.updateProjectionMatrix()}i.setRenderTarget(V.map),i.clear();const Me=V.getViewportCount();for(let ye=0;ye<Me;ye++){const ze=V.getViewport(ye);a.set(r.x*ze.x,r.y*ze.y,r.x*ze.z,r.y*ze.w),W.viewport(a),V.updateMatrices(ne,ye),n=V.getFrustum(),T(A,B,V.camera,ne,this.type)}V.isPointLightShadow!==!0&&this.type===cn&&E(V,B),V.needsUpdate=!1}d=this.type,f.needsUpdate=!1,i.setRenderTarget(ie,g,y)};function E(D,A){const B=e.update(M);p.defines.VSM_SAMPLES!==D.blurSamples&&(p.defines.VSM_SAMPLES=D.blurSamples,u.defines.VSM_SAMPLES=D.blurSamples,p.needsUpdate=!0,u.needsUpdate=!0),D.mapPass===null&&(D.mapPass=new qn(s.x,s.y)),p.uniforms.shadow_pass.value=D.map.texture,p.uniforms.resolution.value=D.mapSize,p.uniforms.radius.value=D.radius,i.setRenderTarget(D.mapPass),i.clear(),i.renderBufferDirect(A,null,B,p,M,null),u.uniforms.shadow_pass.value=D.mapPass.texture,u.uniforms.resolution.value=D.mapSize,u.uniforms.radius.value=D.radius,i.setRenderTarget(D.map),i.clear(),i.renderBufferDirect(A,null,B,u,M,null)}function S(D,A,B,ie){let g=null;const y=B.isPointLight===!0?D.customDistanceMaterial:D.customDepthMaterial;if(y!==void 0)g=y;else if(g=B.isPointLight===!0?l:o,i.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0){const W=g.uuid,H=A.uuid;let Q=c[W];Q===void 0&&(Q={},c[W]=Q);let re=Q[H];re===void 0&&(re=g.clone(),Q[H]=re,A.addEventListener("dispose",z)),g=re}if(g.visible=A.visible,g.wireframe=A.wireframe,ie===cn?g.side=A.shadowSide!==null?A.shadowSide:A.side:g.side=A.shadowSide!==null?A.shadowSide:m[A.side],g.alphaMap=A.alphaMap,g.alphaTest=A.alphaTest,g.map=A.map,g.clipShadows=A.clipShadows,g.clippingPlanes=A.clippingPlanes,g.clipIntersection=A.clipIntersection,g.displacementMap=A.displacementMap,g.displacementScale=A.displacementScale,g.displacementBias=A.displacementBias,g.wireframeLinewidth=A.wireframeLinewidth,g.linewidth=A.linewidth,B.isPointLight===!0&&g.isMeshDistanceMaterial===!0){const W=i.properties.get(g);W.light=B}return g}function T(D,A,B,ie,g){if(D.visible===!1)return;if(D.layers.test(A.layers)&&(D.isMesh||D.isLine||D.isPoints)&&(D.castShadow||D.receiveShadow&&g===cn)&&(!D.frustumCulled||n.intersectsObject(D))){D.modelViewMatrix.multiplyMatrices(B.matrixWorldInverse,D.matrixWorld);const H=e.update(D),Q=D.material;if(Array.isArray(Q)){const re=H.groups;for(let Y=0,ne=re.length;Y<ne;Y++){const V=re[Y],ve=Q[V.materialIndex];if(ve&&ve.visible){const Me=S(D,ve,ie,g);D.onBeforeShadow(i,D,A,B,H,Me,V),i.renderBufferDirect(B,null,H,Me,D,V),D.onAfterShadow(i,D,A,B,H,Me,V)}}}else if(Q.visible){const re=S(D,Q,ie,g);D.onBeforeShadow(i,D,A,B,H,re,null),i.renderBufferDirect(B,null,H,re,D,null),D.onAfterShadow(i,D,A,B,H,re,null)}}const W=D.children;for(let H=0,Q=W.length;H<Q;H++)T(W[H],A,B,ie,g)}function z(D){D.target.removeEventListener("dispose",z);for(const B in c){const ie=c[B],g=D.target.uuid;g in ie&&(ie[g].dispose(),delete ie[g])}}}const Em={[ta]:na,[ia]:aa,[sa]:oa,[bi]:ra,[na]:ta,[aa]:ia,[oa]:sa,[ra]:bi};function bm(i){function e(){let N=!1;const me=new ct;let G=null;const te=new ct(0,0,0,0);return{setMask:function(de){G!==de&&!N&&(i.colorMask(de,de,de,de),G=de)},setLocked:function(de){N=de},setClear:function(de,_e,Xe,ot,Mt){Mt===!0&&(de*=ot,_e*=ot,Xe*=ot),me.set(de,_e,Xe,ot),te.equals(me)===!1&&(i.clearColor(de,_e,Xe,ot),te.copy(me))},reset:function(){N=!1,G=null,te.set(-1,0,0,0)}}}function t(){let N=!1,me=!1,G=null,te=null,de=null;return{setReversed:function(_e){me=_e},setTest:function(_e){_e?Ee(i.DEPTH_TEST):Se(i.DEPTH_TEST)},setMask:function(_e){G!==_e&&!N&&(i.depthMask(_e),G=_e)},setFunc:function(_e){if(me&&(_e=Em[_e]),te!==_e){switch(_e){case ta:i.depthFunc(i.NEVER);break;case na:i.depthFunc(i.ALWAYS);break;case ia:i.depthFunc(i.LESS);break;case bi:i.depthFunc(i.LEQUAL);break;case sa:i.depthFunc(i.EQUAL);break;case ra:i.depthFunc(i.GEQUAL);break;case aa:i.depthFunc(i.GREATER);break;case oa:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}te=_e}},setLocked:function(_e){N=_e},setClear:function(_e){de!==_e&&(i.clearDepth(_e),de=_e)},reset:function(){N=!1,G=null,te=null,de=null}}}function n(){let N=!1,me=null,G=null,te=null,de=null,_e=null,Xe=null,ot=null,Mt=null;return{setTest:function(Ke){N||(Ke?Ee(i.STENCIL_TEST):Se(i.STENCIL_TEST))},setMask:function(Ke){me!==Ke&&!N&&(i.stencilMask(Ke),me=Ke)},setFunc:function(Ke,dt,Gt){(G!==Ke||te!==dt||de!==Gt)&&(i.stencilFunc(Ke,dt,Gt),G=Ke,te=dt,de=Gt)},setOp:function(Ke,dt,Gt){(_e!==Ke||Xe!==dt||ot!==Gt)&&(i.stencilOp(Ke,dt,Gt),_e=Ke,Xe=dt,ot=Gt)},setLocked:function(Ke){N=Ke},setClear:function(Ke){Mt!==Ke&&(i.clearStencil(Ke),Mt=Ke)},reset:function(){N=!1,me=null,G=null,te=null,de=null,_e=null,Xe=null,ot=null,Mt=null}}}const s=new e,r=new t,a=new n,o=new WeakMap,l=new WeakMap;let c={},h={},m=new WeakMap,p=[],u=null,_=!1,M=null,f=null,d=null,E=null,S=null,T=null,z=null,D=new Ye(0,0,0),A=0,B=!1,ie=null,g=null,y=null,W=null,H=null;const Q=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let re=!1,Y=0;const ne=i.getParameter(i.VERSION);ne.indexOf("WebGL")!==-1?(Y=parseFloat(/^WebGL (\d)/.exec(ne)[1]),re=Y>=1):ne.indexOf("OpenGL ES")!==-1&&(Y=parseFloat(/^OpenGL ES (\d)/.exec(ne)[1]),re=Y>=2);let V=null,ve={};const Me=i.getParameter(i.SCISSOR_BOX),ye=i.getParameter(i.VIEWPORT),ze=new ct().fromArray(Me),Be=new ct().fromArray(ye);function j(N,me,G,te){const de=new Uint8Array(4),_e=i.createTexture();i.bindTexture(N,_e),i.texParameteri(N,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(N,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Xe=0;Xe<G;Xe++)N===i.TEXTURE_3D||N===i.TEXTURE_2D_ARRAY?i.texImage3D(me,0,i.RGBA,1,1,te,0,i.RGBA,i.UNSIGNED_BYTE,de):i.texImage2D(me+Xe,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,de);return _e}const ae={};ae[i.TEXTURE_2D]=j(i.TEXTURE_2D,i.TEXTURE_2D,1),ae[i.TEXTURE_CUBE_MAP]=j(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),ae[i.TEXTURE_2D_ARRAY]=j(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),ae[i.TEXTURE_3D]=j(i.TEXTURE_3D,i.TEXTURE_3D,1,1),s.setClear(0,0,0,1),r.setClear(1),a.setClear(0),Ee(i.DEPTH_TEST),r.setFunc(bi),Ve(!1),je(po),Ee(i.CULL_FACE),P(Cn);function Ee(N){c[N]!==!0&&(i.enable(N),c[N]=!0)}function Se(N){c[N]!==!1&&(i.disable(N),c[N]=!1)}function Oe(N,me){return h[N]!==me?(i.bindFramebuffer(N,me),h[N]=me,N===i.DRAW_FRAMEBUFFER&&(h[i.FRAMEBUFFER]=me),N===i.FRAMEBUFFER&&(h[i.DRAW_FRAMEBUFFER]=me),!0):!1}function Le(N,me){let G=p,te=!1;if(N){G=m.get(me),G===void 0&&(G=[],m.set(me,G));const de=N.textures;if(G.length!==de.length||G[0]!==i.COLOR_ATTACHMENT0){for(let _e=0,Xe=de.length;_e<Xe;_e++)G[_e]=i.COLOR_ATTACHMENT0+_e;G.length=de.length,te=!0}}else G[0]!==i.BACK&&(G[0]=i.BACK,te=!0);te&&i.drawBuffers(G)}function qe(N){return u!==N?(i.useProgram(N),u=N,!0):!1}const $e={[Gn]:i.FUNC_ADD,[Bc]:i.FUNC_SUBTRACT,[zc]:i.FUNC_REVERSE_SUBTRACT};$e[kc]=i.MIN,$e[Hc]=i.MAX;const We={[Gc]:i.ZERO,[Vc]:i.ONE,[Wc]:i.SRC_COLOR,[Qr]:i.SRC_ALPHA,[$c]:i.SRC_ALPHA_SATURATE,[jc]:i.DST_COLOR,[Yc]:i.DST_ALPHA,[Xc]:i.ONE_MINUS_SRC_COLOR,[ea]:i.ONE_MINUS_SRC_ALPHA,[Kc]:i.ONE_MINUS_DST_COLOR,[qc]:i.ONE_MINUS_DST_ALPHA,[Zc]:i.CONSTANT_COLOR,[Jc]:i.ONE_MINUS_CONSTANT_COLOR,[Qc]:i.CONSTANT_ALPHA,[eh]:i.ONE_MINUS_CONSTANT_ALPHA};function P(N,me,G,te,de,_e,Xe,ot,Mt,Ke){if(N===Cn){_===!0&&(Se(i.BLEND),_=!1);return}if(_===!1&&(Ee(i.BLEND),_=!0),N!==Oc){if(N!==M||Ke!==B){if((f!==Gn||S!==Gn)&&(i.blendEquation(i.FUNC_ADD),f=Gn,S=Gn),Ke)switch(N){case xi:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case mo:i.blendFunc(i.ONE,i.ONE);break;case _o:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case go:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}else switch(N){case xi:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case mo:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case _o:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case go:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}d=null,E=null,T=null,z=null,D.set(0,0,0),A=0,M=N,B=Ke}return}de=de||me,_e=_e||G,Xe=Xe||te,(me!==f||de!==S)&&(i.blendEquationSeparate($e[me],$e[de]),f=me,S=de),(G!==d||te!==E||_e!==T||Xe!==z)&&(i.blendFuncSeparate(We[G],We[te],We[_e],We[Xe]),d=G,E=te,T=_e,z=Xe),(ot.equals(D)===!1||Mt!==A)&&(i.blendColor(ot.r,ot.g,ot.b,Mt),D.copy(ot),A=Mt),M=N,B=!1}function vt(N,me){N.side===hn?Se(i.CULL_FACE):Ee(i.CULL_FACE);let G=N.side===wt;me&&(G=!G),Ve(G),N.blending===xi&&N.transparent===!1?P(Cn):P(N.blending,N.blendEquation,N.blendSrc,N.blendDst,N.blendEquationAlpha,N.blendSrcAlpha,N.blendDstAlpha,N.blendColor,N.blendAlpha,N.premultipliedAlpha),r.setFunc(N.depthFunc),r.setTest(N.depthTest),r.setMask(N.depthWrite),s.setMask(N.colorWrite);const te=N.stencilWrite;a.setTest(te),te&&(a.setMask(N.stencilWriteMask),a.setFunc(N.stencilFunc,N.stencilRef,N.stencilFuncMask),a.setOp(N.stencilFail,N.stencilZFail,N.stencilZPass)),tt(N.polygonOffset,N.polygonOffsetFactor,N.polygonOffsetUnits),N.alphaToCoverage===!0?Ee(i.SAMPLE_ALPHA_TO_COVERAGE):Se(i.SAMPLE_ALPHA_TO_COVERAGE)}function Ve(N){ie!==N&&(N?i.frontFace(i.CW):i.frontFace(i.CCW),ie=N)}function je(N){N!==Nc?(Ee(i.CULL_FACE),N!==g&&(N===po?i.cullFace(i.BACK):N===Uc?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Se(i.CULL_FACE),g=N}function De(N){N!==y&&(re&&i.lineWidth(N),y=N)}function tt(N,me,G){N?(Ee(i.POLYGON_OFFSET_FILL),(W!==me||H!==G)&&(i.polygonOffset(me,G),W=me,H=G)):Se(i.POLYGON_OFFSET_FILL)}function Ne(N){N?Ee(i.SCISSOR_TEST):Se(i.SCISSOR_TEST)}function b(N){N===void 0&&(N=i.TEXTURE0+Q-1),V!==N&&(i.activeTexture(N),V=N)}function x(N,me,G){G===void 0&&(V===null?G=i.TEXTURE0+Q-1:G=V);let te=ve[G];te===void 0&&(te={type:void 0,texture:void 0},ve[G]=te),(te.type!==N||te.texture!==me)&&(V!==G&&(i.activeTexture(G),V=G),i.bindTexture(N,me||ae[N]),te.type=N,te.texture=me)}function k(){const N=ve[V];N!==void 0&&N.type!==void 0&&(i.bindTexture(N.type,null),N.type=void 0,N.texture=void 0)}function q(){try{i.compressedTexImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function se(){try{i.compressedTexImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Z(){try{i.texSubImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function be(){try{i.texSubImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function he(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function xe(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Fe(){try{i.texStorage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function oe(){try{i.texStorage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function fe(){try{i.texImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Pe(){try{i.texImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Ae(N){ze.equals(N)===!1&&(i.scissor(N.x,N.y,N.z,N.w),ze.copy(N))}function pe(N){Be.equals(N)===!1&&(i.viewport(N.x,N.y,N.z,N.w),Be.copy(N))}function ke(N,me){let G=l.get(me);G===void 0&&(G=new WeakMap,l.set(me,G));let te=G.get(N);te===void 0&&(te=i.getUniformBlockIndex(me,N.name),G.set(N,te))}function Ie(N,me){const te=l.get(me).get(N);o.get(me)!==te&&(i.uniformBlockBinding(me,te,N.__bindingPointIndex),o.set(me,te))}function nt(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),c={},V=null,ve={},h={},m=new WeakMap,p=[],u=null,_=!1,M=null,f=null,d=null,E=null,S=null,T=null,z=null,D=new Ye(0,0,0),A=0,B=!1,ie=null,g=null,y=null,W=null,H=null,ze.set(0,0,i.canvas.width,i.canvas.height),Be.set(0,0,i.canvas.width,i.canvas.height),s.reset(),r.reset(),a.reset()}return{buffers:{color:s,depth:r,stencil:a},enable:Ee,disable:Se,bindFramebuffer:Oe,drawBuffers:Le,useProgram:qe,setBlending:P,setMaterial:vt,setFlipSided:Ve,setCullFace:je,setLineWidth:De,setPolygonOffset:tt,setScissorTest:Ne,activeTexture:b,bindTexture:x,unbindTexture:k,compressedTexImage2D:q,compressedTexImage3D:se,texImage2D:fe,texImage3D:Pe,updateUBOMapping:ke,uniformBlockBinding:Ie,texStorage2D:Fe,texStorage3D:oe,texSubImage2D:Z,texSubImage3D:be,compressedTexSubImage2D:he,compressedTexSubImage3D:xe,scissor:Ae,viewport:pe,reset:nt}}function ol(i,e,t,n){const s=Tm(n);switch(t){case Vl:return i*e;case Xl:return i*e;case Yl:return i*e*2;case ql:return i*e/s.components*s.byteLength;case qa:return i*e/s.components*s.byteLength;case jl:return i*e*2/s.components*s.byteLength;case ja:return i*e*2/s.components*s.byteLength;case Wl:return i*e*3/s.components*s.byteLength;case Kt:return i*e*4/s.components*s.byteLength;case Ka:return i*e*4/s.components*s.byteLength;case Ls:case Ds:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Is:case Ns:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case fa:case ma:return Math.max(i,16)*Math.max(e,8)/4;case da:case pa:return Math.max(i,8)*Math.max(e,8)/2;case _a:case ga:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case va:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case xa:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Ma:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case Sa:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case ya:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case Ea:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case ba:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case Ta:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case Aa:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case wa:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case Ra:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case Ca:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case Pa:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case La:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case Da:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case Us:case Ia:case Na:return Math.ceil(i/4)*Math.ceil(e/4)*16;case Kl:case Ua:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Fa:case Oa:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function Tm(i){switch(i){case pn:case kl:return{byteLength:1,components:1};case qi:case Hl:case ji:return{byteLength:2,components:1};case Xa:case Ya:return{byteLength:2,components:4};case Yn:case Wa:case un:return{byteLength:4,components:1};case Gl:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}function Am(i,e,t,n,s,r,a){const o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ue,h=new WeakMap;let m;const p=new WeakMap;let u=!1;try{u=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function _(b,x){return u?new OffscreenCanvas(b,x):Xs("canvas")}function M(b,x,k){let q=1;const se=Ne(b);if((se.width>k||se.height>k)&&(q=k/Math.max(se.width,se.height)),q<1)if(typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&b instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&b instanceof ImageBitmap||typeof VideoFrame<"u"&&b instanceof VideoFrame){const Z=Math.floor(q*se.width),be=Math.floor(q*se.height);m===void 0&&(m=_(Z,be));const he=x?_(Z,be):m;return he.width=Z,he.height=be,he.getContext("2d").drawImage(b,0,0,Z,be),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+se.width+"x"+se.height+") to ("+Z+"x"+be+")."),he}else return"data"in b&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+se.width+"x"+se.height+")."),b;return b}function f(b){return b.generateMipmaps&&b.minFilter!==zt&&b.minFilter!==qt}function d(b){i.generateMipmap(b)}function E(b,x,k,q,se=!1){if(b!==null){if(i[b]!==void 0)return i[b];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+b+"'")}let Z=x;if(x===i.RED&&(k===i.FLOAT&&(Z=i.R32F),k===i.HALF_FLOAT&&(Z=i.R16F),k===i.UNSIGNED_BYTE&&(Z=i.R8)),x===i.RED_INTEGER&&(k===i.UNSIGNED_BYTE&&(Z=i.R8UI),k===i.UNSIGNED_SHORT&&(Z=i.R16UI),k===i.UNSIGNED_INT&&(Z=i.R32UI),k===i.BYTE&&(Z=i.R8I),k===i.SHORT&&(Z=i.R16I),k===i.INT&&(Z=i.R32I)),x===i.RG&&(k===i.FLOAT&&(Z=i.RG32F),k===i.HALF_FLOAT&&(Z=i.RG16F),k===i.UNSIGNED_BYTE&&(Z=i.RG8)),x===i.RG_INTEGER&&(k===i.UNSIGNED_BYTE&&(Z=i.RG8UI),k===i.UNSIGNED_SHORT&&(Z=i.RG16UI),k===i.UNSIGNED_INT&&(Z=i.RG32UI),k===i.BYTE&&(Z=i.RG8I),k===i.SHORT&&(Z=i.RG16I),k===i.INT&&(Z=i.RG32I)),x===i.RGB_INTEGER&&(k===i.UNSIGNED_BYTE&&(Z=i.RGB8UI),k===i.UNSIGNED_SHORT&&(Z=i.RGB16UI),k===i.UNSIGNED_INT&&(Z=i.RGB32UI),k===i.BYTE&&(Z=i.RGB8I),k===i.SHORT&&(Z=i.RGB16I),k===i.INT&&(Z=i.RGB32I)),x===i.RGBA_INTEGER&&(k===i.UNSIGNED_BYTE&&(Z=i.RGBA8UI),k===i.UNSIGNED_SHORT&&(Z=i.RGBA16UI),k===i.UNSIGNED_INT&&(Z=i.RGBA32UI),k===i.BYTE&&(Z=i.RGBA8I),k===i.SHORT&&(Z=i.RGBA16I),k===i.INT&&(Z=i.RGBA32I)),x===i.RGB&&k===i.UNSIGNED_INT_5_9_9_9_REV&&(Z=i.RGB9_E5),x===i.RGBA){const be=se?Hs:et.getTransfer(q);k===i.FLOAT&&(Z=i.RGBA32F),k===i.HALF_FLOAT&&(Z=i.RGBA16F),k===i.UNSIGNED_BYTE&&(Z=be===at?i.SRGB8_ALPHA8:i.RGBA8),k===i.UNSIGNED_SHORT_4_4_4_4&&(Z=i.RGBA4),k===i.UNSIGNED_SHORT_5_5_5_1&&(Z=i.RGB5_A1)}return(Z===i.R16F||Z===i.R32F||Z===i.RG16F||Z===i.RG32F||Z===i.RGBA16F||Z===i.RGBA32F)&&e.get("EXT_color_buffer_float"),Z}function S(b,x){let k;return b?x===null||x===Yn||x===wi?k=i.DEPTH24_STENCIL8:x===un?k=i.DEPTH32F_STENCIL8:x===qi&&(k=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):x===null||x===Yn||x===wi?k=i.DEPTH_COMPONENT24:x===un?k=i.DEPTH_COMPONENT32F:x===qi&&(k=i.DEPTH_COMPONENT16),k}function T(b,x){return f(b)===!0||b.isFramebufferTexture&&b.minFilter!==zt&&b.minFilter!==qt?Math.log2(Math.max(x.width,x.height))+1:b.mipmaps!==void 0&&b.mipmaps.length>0?b.mipmaps.length:b.isCompressedTexture&&Array.isArray(b.image)?x.mipmaps.length:1}function z(b){const x=b.target;x.removeEventListener("dispose",z),A(x),x.isVideoTexture&&h.delete(x)}function D(b){const x=b.target;x.removeEventListener("dispose",D),ie(x)}function A(b){const x=n.get(b);if(x.__webglInit===void 0)return;const k=b.source,q=p.get(k);if(q){const se=q[x.__cacheKey];se.usedTimes--,se.usedTimes===0&&B(b),Object.keys(q).length===0&&p.delete(k)}n.remove(b)}function B(b){const x=n.get(b);i.deleteTexture(x.__webglTexture);const k=b.source,q=p.get(k);delete q[x.__cacheKey],a.memory.textures--}function ie(b){const x=n.get(b);if(b.depthTexture&&b.depthTexture.dispose(),b.isWebGLCubeRenderTarget)for(let q=0;q<6;q++){if(Array.isArray(x.__webglFramebuffer[q]))for(let se=0;se<x.__webglFramebuffer[q].length;se++)i.deleteFramebuffer(x.__webglFramebuffer[q][se]);else i.deleteFramebuffer(x.__webglFramebuffer[q]);x.__webglDepthbuffer&&i.deleteRenderbuffer(x.__webglDepthbuffer[q])}else{if(Array.isArray(x.__webglFramebuffer))for(let q=0;q<x.__webglFramebuffer.length;q++)i.deleteFramebuffer(x.__webglFramebuffer[q]);else i.deleteFramebuffer(x.__webglFramebuffer);if(x.__webglDepthbuffer&&i.deleteRenderbuffer(x.__webglDepthbuffer),x.__webglMultisampledFramebuffer&&i.deleteFramebuffer(x.__webglMultisampledFramebuffer),x.__webglColorRenderbuffer)for(let q=0;q<x.__webglColorRenderbuffer.length;q++)x.__webglColorRenderbuffer[q]&&i.deleteRenderbuffer(x.__webglColorRenderbuffer[q]);x.__webglDepthRenderbuffer&&i.deleteRenderbuffer(x.__webglDepthRenderbuffer)}const k=b.textures;for(let q=0,se=k.length;q<se;q++){const Z=n.get(k[q]);Z.__webglTexture&&(i.deleteTexture(Z.__webglTexture),a.memory.textures--),n.remove(k[q])}n.remove(b)}let g=0;function y(){g=0}function W(){const b=g;return b>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+b+" texture units while this GPU supports only "+s.maxTextures),g+=1,b}function H(b){const x=[];return x.push(b.wrapS),x.push(b.wrapT),x.push(b.wrapR||0),x.push(b.magFilter),x.push(b.minFilter),x.push(b.anisotropy),x.push(b.internalFormat),x.push(b.format),x.push(b.type),x.push(b.generateMipmaps),x.push(b.premultiplyAlpha),x.push(b.flipY),x.push(b.unpackAlignment),x.push(b.colorSpace),x.join()}function Q(b,x){const k=n.get(b);if(b.isVideoTexture&&De(b),b.isRenderTargetTexture===!1&&b.version>0&&k.__version!==b.version){const q=b.image;if(q===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(q.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{Be(k,b,x);return}}t.bindTexture(i.TEXTURE_2D,k.__webglTexture,i.TEXTURE0+x)}function re(b,x){const k=n.get(b);if(b.version>0&&k.__version!==b.version){Be(k,b,x);return}t.bindTexture(i.TEXTURE_2D_ARRAY,k.__webglTexture,i.TEXTURE0+x)}function Y(b,x){const k=n.get(b);if(b.version>0&&k.__version!==b.version){Be(k,b,x);return}t.bindTexture(i.TEXTURE_3D,k.__webglTexture,i.TEXTURE0+x)}function ne(b,x){const k=n.get(b);if(b.version>0&&k.__version!==b.version){j(k,b,x);return}t.bindTexture(i.TEXTURE_CUBE_MAP,k.__webglTexture,i.TEXTURE0+x)}const V={[ha]:i.REPEAT,[Wn]:i.CLAMP_TO_EDGE,[ua]:i.MIRRORED_REPEAT},ve={[zt]:i.NEAREST,[hh]:i.NEAREST_MIPMAP_NEAREST,[ss]:i.NEAREST_MIPMAP_LINEAR,[qt]:i.LINEAR,[fr]:i.LINEAR_MIPMAP_NEAREST,[Xn]:i.LINEAR_MIPMAP_LINEAR},Me={[ph]:i.NEVER,[Mh]:i.ALWAYS,[mh]:i.LESS,[Zl]:i.LEQUAL,[_h]:i.EQUAL,[xh]:i.GEQUAL,[gh]:i.GREATER,[vh]:i.NOTEQUAL};function ye(b,x){if(x.type===un&&e.has("OES_texture_float_linear")===!1&&(x.magFilter===qt||x.magFilter===fr||x.magFilter===ss||x.magFilter===Xn||x.minFilter===qt||x.minFilter===fr||x.minFilter===ss||x.minFilter===Xn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(b,i.TEXTURE_WRAP_S,V[x.wrapS]),i.texParameteri(b,i.TEXTURE_WRAP_T,V[x.wrapT]),(b===i.TEXTURE_3D||b===i.TEXTURE_2D_ARRAY)&&i.texParameteri(b,i.TEXTURE_WRAP_R,V[x.wrapR]),i.texParameteri(b,i.TEXTURE_MAG_FILTER,ve[x.magFilter]),i.texParameteri(b,i.TEXTURE_MIN_FILTER,ve[x.minFilter]),x.compareFunction&&(i.texParameteri(b,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(b,i.TEXTURE_COMPARE_FUNC,Me[x.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(x.magFilter===zt||x.minFilter!==ss&&x.minFilter!==Xn||x.type===un&&e.has("OES_texture_float_linear")===!1)return;if(x.anisotropy>1||n.get(x).__currentAnisotropy){const k=e.get("EXT_texture_filter_anisotropic");i.texParameterf(b,k.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(x.anisotropy,s.getMaxAnisotropy())),n.get(x).__currentAnisotropy=x.anisotropy}}}function ze(b,x){let k=!1;b.__webglInit===void 0&&(b.__webglInit=!0,x.addEventListener("dispose",z));const q=x.source;let se=p.get(q);se===void 0&&(se={},p.set(q,se));const Z=H(x);if(Z!==b.__cacheKey){se[Z]===void 0&&(se[Z]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,k=!0),se[Z].usedTimes++;const be=se[b.__cacheKey];be!==void 0&&(se[b.__cacheKey].usedTimes--,be.usedTimes===0&&B(x)),b.__cacheKey=Z,b.__webglTexture=se[Z].texture}return k}function Be(b,x,k){let q=i.TEXTURE_2D;(x.isDataArrayTexture||x.isCompressedArrayTexture)&&(q=i.TEXTURE_2D_ARRAY),x.isData3DTexture&&(q=i.TEXTURE_3D);const se=ze(b,x),Z=x.source;t.bindTexture(q,b.__webglTexture,i.TEXTURE0+k);const be=n.get(Z);if(Z.version!==be.__version||se===!0){t.activeTexture(i.TEXTURE0+k);const he=et.getPrimaries(et.workingColorSpace),xe=x.colorSpace===Tn?null:et.getPrimaries(x.colorSpace),Fe=x.colorSpace===Tn||he===xe?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Fe);let oe=M(x.image,!1,s.maxTextureSize);oe=tt(x,oe);const fe=r.convert(x.format,x.colorSpace),Pe=r.convert(x.type);let Ae=E(x.internalFormat,fe,Pe,x.colorSpace,x.isVideoTexture);ye(q,x);let pe;const ke=x.mipmaps,Ie=x.isVideoTexture!==!0,nt=be.__version===void 0||se===!0,N=Z.dataReady,me=T(x,oe);if(x.isDepthTexture)Ae=S(x.format===Ri,x.type),nt&&(Ie?t.texStorage2D(i.TEXTURE_2D,1,Ae,oe.width,oe.height):t.texImage2D(i.TEXTURE_2D,0,Ae,oe.width,oe.height,0,fe,Pe,null));else if(x.isDataTexture)if(ke.length>0){Ie&&nt&&t.texStorage2D(i.TEXTURE_2D,me,Ae,ke[0].width,ke[0].height);for(let G=0,te=ke.length;G<te;G++)pe=ke[G],Ie?N&&t.texSubImage2D(i.TEXTURE_2D,G,0,0,pe.width,pe.height,fe,Pe,pe.data):t.texImage2D(i.TEXTURE_2D,G,Ae,pe.width,pe.height,0,fe,Pe,pe.data);x.generateMipmaps=!1}else Ie?(nt&&t.texStorage2D(i.TEXTURE_2D,me,Ae,oe.width,oe.height),N&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,oe.width,oe.height,fe,Pe,oe.data)):t.texImage2D(i.TEXTURE_2D,0,Ae,oe.width,oe.height,0,fe,Pe,oe.data);else if(x.isCompressedTexture)if(x.isCompressedArrayTexture){Ie&&nt&&t.texStorage3D(i.TEXTURE_2D_ARRAY,me,Ae,ke[0].width,ke[0].height,oe.depth);for(let G=0,te=ke.length;G<te;G++)if(pe=ke[G],x.format!==Kt)if(fe!==null)if(Ie){if(N)if(x.layerUpdates.size>0){const de=ol(pe.width,pe.height,x.format,x.type);for(const _e of x.layerUpdates){const Xe=pe.data.subarray(_e*de/pe.data.BYTES_PER_ELEMENT,(_e+1)*de/pe.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,G,0,0,_e,pe.width,pe.height,1,fe,Xe,0,0)}x.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,G,0,0,0,pe.width,pe.height,oe.depth,fe,pe.data,0,0)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,G,Ae,pe.width,pe.height,oe.depth,0,pe.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Ie?N&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,G,0,0,0,pe.width,pe.height,oe.depth,fe,Pe,pe.data):t.texImage3D(i.TEXTURE_2D_ARRAY,G,Ae,pe.width,pe.height,oe.depth,0,fe,Pe,pe.data)}else{Ie&&nt&&t.texStorage2D(i.TEXTURE_2D,me,Ae,ke[0].width,ke[0].height);for(let G=0,te=ke.length;G<te;G++)pe=ke[G],x.format!==Kt?fe!==null?Ie?N&&t.compressedTexSubImage2D(i.TEXTURE_2D,G,0,0,pe.width,pe.height,fe,pe.data):t.compressedTexImage2D(i.TEXTURE_2D,G,Ae,pe.width,pe.height,0,pe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Ie?N&&t.texSubImage2D(i.TEXTURE_2D,G,0,0,pe.width,pe.height,fe,Pe,pe.data):t.texImage2D(i.TEXTURE_2D,G,Ae,pe.width,pe.height,0,fe,Pe,pe.data)}else if(x.isDataArrayTexture)if(Ie){if(nt&&t.texStorage3D(i.TEXTURE_2D_ARRAY,me,Ae,oe.width,oe.height,oe.depth),N)if(x.layerUpdates.size>0){const G=ol(oe.width,oe.height,x.format,x.type);for(const te of x.layerUpdates){const de=oe.data.subarray(te*G/oe.data.BYTES_PER_ELEMENT,(te+1)*G/oe.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,te,oe.width,oe.height,1,fe,Pe,de)}x.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,oe.width,oe.height,oe.depth,fe,Pe,oe.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,Ae,oe.width,oe.height,oe.depth,0,fe,Pe,oe.data);else if(x.isData3DTexture)Ie?(nt&&t.texStorage3D(i.TEXTURE_3D,me,Ae,oe.width,oe.height,oe.depth),N&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,oe.width,oe.height,oe.depth,fe,Pe,oe.data)):t.texImage3D(i.TEXTURE_3D,0,Ae,oe.width,oe.height,oe.depth,0,fe,Pe,oe.data);else if(x.isFramebufferTexture){if(nt)if(Ie)t.texStorage2D(i.TEXTURE_2D,me,Ae,oe.width,oe.height);else{let G=oe.width,te=oe.height;for(let de=0;de<me;de++)t.texImage2D(i.TEXTURE_2D,de,Ae,G,te,0,fe,Pe,null),G>>=1,te>>=1}}else if(ke.length>0){if(Ie&&nt){const G=Ne(ke[0]);t.texStorage2D(i.TEXTURE_2D,me,Ae,G.width,G.height)}for(let G=0,te=ke.length;G<te;G++)pe=ke[G],Ie?N&&t.texSubImage2D(i.TEXTURE_2D,G,0,0,fe,Pe,pe):t.texImage2D(i.TEXTURE_2D,G,Ae,fe,Pe,pe);x.generateMipmaps=!1}else if(Ie){if(nt){const G=Ne(oe);t.texStorage2D(i.TEXTURE_2D,me,Ae,G.width,G.height)}N&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,fe,Pe,oe)}else t.texImage2D(i.TEXTURE_2D,0,Ae,fe,Pe,oe);f(x)&&d(q),be.__version=Z.version,x.onUpdate&&x.onUpdate(x)}b.__version=x.version}function j(b,x,k){if(x.image.length!==6)return;const q=ze(b,x),se=x.source;t.bindTexture(i.TEXTURE_CUBE_MAP,b.__webglTexture,i.TEXTURE0+k);const Z=n.get(se);if(se.version!==Z.__version||q===!0){t.activeTexture(i.TEXTURE0+k);const be=et.getPrimaries(et.workingColorSpace),he=x.colorSpace===Tn?null:et.getPrimaries(x.colorSpace),xe=x.colorSpace===Tn||be===he?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,xe);const Fe=x.isCompressedTexture||x.image[0].isCompressedTexture,oe=x.image[0]&&x.image[0].isDataTexture,fe=[];for(let te=0;te<6;te++)!Fe&&!oe?fe[te]=M(x.image[te],!0,s.maxCubemapSize):fe[te]=oe?x.image[te].image:x.image[te],fe[te]=tt(x,fe[te]);const Pe=fe[0],Ae=r.convert(x.format,x.colorSpace),pe=r.convert(x.type),ke=E(x.internalFormat,Ae,pe,x.colorSpace),Ie=x.isVideoTexture!==!0,nt=Z.__version===void 0||q===!0,N=se.dataReady;let me=T(x,Pe);ye(i.TEXTURE_CUBE_MAP,x);let G;if(Fe){Ie&&nt&&t.texStorage2D(i.TEXTURE_CUBE_MAP,me,ke,Pe.width,Pe.height);for(let te=0;te<6;te++){G=fe[te].mipmaps;for(let de=0;de<G.length;de++){const _e=G[de];x.format!==Kt?Ae!==null?Ie?N&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de,0,0,_e.width,_e.height,Ae,_e.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de,ke,_e.width,_e.height,0,_e.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de,0,0,_e.width,_e.height,Ae,pe,_e.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de,ke,_e.width,_e.height,0,Ae,pe,_e.data)}}}else{if(G=x.mipmaps,Ie&&nt){G.length>0&&me++;const te=Ne(fe[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,me,ke,te.width,te.height)}for(let te=0;te<6;te++)if(oe){Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,0,0,fe[te].width,fe[te].height,Ae,pe,fe[te].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,ke,fe[te].width,fe[te].height,0,Ae,pe,fe[te].data);for(let de=0;de<G.length;de++){const Xe=G[de].image[te].image;Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de+1,0,0,Xe.width,Xe.height,Ae,pe,Xe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de+1,ke,Xe.width,Xe.height,0,Ae,pe,Xe.data)}}else{Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,0,0,Ae,pe,fe[te]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,ke,Ae,pe,fe[te]);for(let de=0;de<G.length;de++){const _e=G[de];Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de+1,0,0,Ae,pe,_e.image[te]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+te,de+1,ke,Ae,pe,_e.image[te])}}}f(x)&&d(i.TEXTURE_CUBE_MAP),Z.__version=se.version,x.onUpdate&&x.onUpdate(x)}b.__version=x.version}function ae(b,x,k,q,se,Z){const be=r.convert(k.format,k.colorSpace),he=r.convert(k.type),xe=E(k.internalFormat,be,he,k.colorSpace);if(!n.get(x).__hasExternalTextures){const oe=Math.max(1,x.width>>Z),fe=Math.max(1,x.height>>Z);se===i.TEXTURE_3D||se===i.TEXTURE_2D_ARRAY?t.texImage3D(se,Z,xe,oe,fe,x.depth,0,be,he,null):t.texImage2D(se,Z,xe,oe,fe,0,be,he,null)}t.bindFramebuffer(i.FRAMEBUFFER,b),je(x)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,q,se,n.get(k).__webglTexture,0,Ve(x)):(se===i.TEXTURE_2D||se>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&se<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,q,se,n.get(k).__webglTexture,Z),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Ee(b,x,k){if(i.bindRenderbuffer(i.RENDERBUFFER,b),x.depthBuffer){const q=x.depthTexture,se=q&&q.isDepthTexture?q.type:null,Z=S(x.stencilBuffer,se),be=x.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,he=Ve(x);je(x)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,he,Z,x.width,x.height):k?i.renderbufferStorageMultisample(i.RENDERBUFFER,he,Z,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,Z,x.width,x.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,be,i.RENDERBUFFER,b)}else{const q=x.textures;for(let se=0;se<q.length;se++){const Z=q[se],be=r.convert(Z.format,Z.colorSpace),he=r.convert(Z.type),xe=E(Z.internalFormat,be,he,Z.colorSpace),Fe=Ve(x);k&&je(x)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Fe,xe,x.width,x.height):je(x)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Fe,xe,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,xe,x.width,x.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Se(b,x){if(x&&x.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,b),!(x.depthTexture&&x.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!n.get(x.depthTexture).__webglTexture||x.depthTexture.image.width!==x.width||x.depthTexture.image.height!==x.height)&&(x.depthTexture.image.width=x.width,x.depthTexture.image.height=x.height,x.depthTexture.needsUpdate=!0),Q(x.depthTexture,0);const q=n.get(x.depthTexture).__webglTexture,se=Ve(x);if(x.depthTexture.format===Mi)je(x)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,q,0,se):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,q,0);else if(x.depthTexture.format===Ri)je(x)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,q,0,se):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,q,0);else throw new Error("Unknown depthTexture format")}function Oe(b){const x=n.get(b),k=b.isWebGLCubeRenderTarget===!0;if(x.__boundDepthTexture!==b.depthTexture){const q=b.depthTexture;if(x.__depthDisposeCallback&&x.__depthDisposeCallback(),q){const se=()=>{delete x.__boundDepthTexture,delete x.__depthDisposeCallback,q.removeEventListener("dispose",se)};q.addEventListener("dispose",se),x.__depthDisposeCallback=se}x.__boundDepthTexture=q}if(b.depthTexture&&!x.__autoAllocateDepthBuffer){if(k)throw new Error("target.depthTexture not supported in Cube render targets");Se(x.__webglFramebuffer,b)}else if(k){x.__webglDepthbuffer=[];for(let q=0;q<6;q++)if(t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer[q]),x.__webglDepthbuffer[q]===void 0)x.__webglDepthbuffer[q]=i.createRenderbuffer(),Ee(x.__webglDepthbuffer[q],b,!1);else{const se=b.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,Z=x.__webglDepthbuffer[q];i.bindRenderbuffer(i.RENDERBUFFER,Z),i.framebufferRenderbuffer(i.FRAMEBUFFER,se,i.RENDERBUFFER,Z)}}else if(t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer),x.__webglDepthbuffer===void 0)x.__webglDepthbuffer=i.createRenderbuffer(),Ee(x.__webglDepthbuffer,b,!1);else{const q=b.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,se=x.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,se),i.framebufferRenderbuffer(i.FRAMEBUFFER,q,i.RENDERBUFFER,se)}t.bindFramebuffer(i.FRAMEBUFFER,null)}function Le(b,x,k){const q=n.get(b);x!==void 0&&ae(q.__webglFramebuffer,b,b.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),k!==void 0&&Oe(b)}function qe(b){const x=b.texture,k=n.get(b),q=n.get(x);b.addEventListener("dispose",D);const se=b.textures,Z=b.isWebGLCubeRenderTarget===!0,be=se.length>1;if(be||(q.__webglTexture===void 0&&(q.__webglTexture=i.createTexture()),q.__version=x.version,a.memory.textures++),Z){k.__webglFramebuffer=[];for(let he=0;he<6;he++)if(x.mipmaps&&x.mipmaps.length>0){k.__webglFramebuffer[he]=[];for(let xe=0;xe<x.mipmaps.length;xe++)k.__webglFramebuffer[he][xe]=i.createFramebuffer()}else k.__webglFramebuffer[he]=i.createFramebuffer()}else{if(x.mipmaps&&x.mipmaps.length>0){k.__webglFramebuffer=[];for(let he=0;he<x.mipmaps.length;he++)k.__webglFramebuffer[he]=i.createFramebuffer()}else k.__webglFramebuffer=i.createFramebuffer();if(be)for(let he=0,xe=se.length;he<xe;he++){const Fe=n.get(se[he]);Fe.__webglTexture===void 0&&(Fe.__webglTexture=i.createTexture(),a.memory.textures++)}if(b.samples>0&&je(b)===!1){k.__webglMultisampledFramebuffer=i.createFramebuffer(),k.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,k.__webglMultisampledFramebuffer);for(let he=0;he<se.length;he++){const xe=se[he];k.__webglColorRenderbuffer[he]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,k.__webglColorRenderbuffer[he]);const Fe=r.convert(xe.format,xe.colorSpace),oe=r.convert(xe.type),fe=E(xe.internalFormat,Fe,oe,xe.colorSpace,b.isXRRenderTarget===!0),Pe=Ve(b);i.renderbufferStorageMultisample(i.RENDERBUFFER,Pe,fe,b.width,b.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+he,i.RENDERBUFFER,k.__webglColorRenderbuffer[he])}i.bindRenderbuffer(i.RENDERBUFFER,null),b.depthBuffer&&(k.__webglDepthRenderbuffer=i.createRenderbuffer(),Ee(k.__webglDepthRenderbuffer,b,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(Z){t.bindTexture(i.TEXTURE_CUBE_MAP,q.__webglTexture),ye(i.TEXTURE_CUBE_MAP,x);for(let he=0;he<6;he++)if(x.mipmaps&&x.mipmaps.length>0)for(let xe=0;xe<x.mipmaps.length;xe++)ae(k.__webglFramebuffer[he][xe],b,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+he,xe);else ae(k.__webglFramebuffer[he],b,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+he,0);f(x)&&d(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(be){for(let he=0,xe=se.length;he<xe;he++){const Fe=se[he],oe=n.get(Fe);t.bindTexture(i.TEXTURE_2D,oe.__webglTexture),ye(i.TEXTURE_2D,Fe),ae(k.__webglFramebuffer,b,Fe,i.COLOR_ATTACHMENT0+he,i.TEXTURE_2D,0),f(Fe)&&d(i.TEXTURE_2D)}t.unbindTexture()}else{let he=i.TEXTURE_2D;if((b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(he=b.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(he,q.__webglTexture),ye(he,x),x.mipmaps&&x.mipmaps.length>0)for(let xe=0;xe<x.mipmaps.length;xe++)ae(k.__webglFramebuffer[xe],b,x,i.COLOR_ATTACHMENT0,he,xe);else ae(k.__webglFramebuffer,b,x,i.COLOR_ATTACHMENT0,he,0);f(x)&&d(he),t.unbindTexture()}b.depthBuffer&&Oe(b)}function $e(b){const x=b.textures;for(let k=0,q=x.length;k<q;k++){const se=x[k];if(f(se)){const Z=b.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:i.TEXTURE_2D,be=n.get(se).__webglTexture;t.bindTexture(Z,be),d(Z),t.unbindTexture()}}}const We=[],P=[];function vt(b){if(b.samples>0){if(je(b)===!1){const x=b.textures,k=b.width,q=b.height;let se=i.COLOR_BUFFER_BIT;const Z=b.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,be=n.get(b),he=x.length>1;if(he)for(let xe=0;xe<x.length;xe++)t.bindFramebuffer(i.FRAMEBUFFER,be.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+xe,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,be.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+xe,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,be.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,be.__webglFramebuffer);for(let xe=0;xe<x.length;xe++){if(b.resolveDepthBuffer&&(b.depthBuffer&&(se|=i.DEPTH_BUFFER_BIT),b.stencilBuffer&&b.resolveStencilBuffer&&(se|=i.STENCIL_BUFFER_BIT)),he){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,be.__webglColorRenderbuffer[xe]);const Fe=n.get(x[xe]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,Fe,0)}i.blitFramebuffer(0,0,k,q,0,0,k,q,se,i.NEAREST),l===!0&&(We.length=0,P.length=0,We.push(i.COLOR_ATTACHMENT0+xe),b.depthBuffer&&b.resolveDepthBuffer===!1&&(We.push(Z),P.push(Z),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,P)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,We))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),he)for(let xe=0;xe<x.length;xe++){t.bindFramebuffer(i.FRAMEBUFFER,be.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+xe,i.RENDERBUFFER,be.__webglColorRenderbuffer[xe]);const Fe=n.get(x[xe]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,be.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+xe,i.TEXTURE_2D,Fe,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,be.__webglMultisampledFramebuffer)}else if(b.depthBuffer&&b.resolveDepthBuffer===!1&&l){const x=b.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[x])}}}function Ve(b){return Math.min(s.maxSamples,b.samples)}function je(b){const x=n.get(b);return b.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&x.__useRenderToTexture!==!1}function De(b){const x=a.render.frame;h.get(b)!==x&&(h.set(b,x),b.update())}function tt(b,x){const k=b.colorSpace,q=b.format,se=b.type;return b.isCompressedTexture===!0||b.isVideoTexture===!0||k!==In&&k!==Tn&&(et.getTransfer(k)===at?(q!==Kt||se!==pn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",k)),x}function Ne(b){return typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement?(c.width=b.naturalWidth||b.width,c.height=b.naturalHeight||b.height):typeof VideoFrame<"u"&&b instanceof VideoFrame?(c.width=b.displayWidth,c.height=b.displayHeight):(c.width=b.width,c.height=b.height),c}this.allocateTextureUnit=W,this.resetTextureUnits=y,this.setTexture2D=Q,this.setTexture2DArray=re,this.setTexture3D=Y,this.setTextureCube=ne,this.rebindTextures=Le,this.setupRenderTarget=qe,this.updateRenderTargetMipmap=$e,this.updateMultisampleRenderTarget=vt,this.setupDepthRenderbuffer=Oe,this.setupFrameBufferTexture=ae,this.useMultisampledRTT=je}function wm(i,e){function t(n,s=Tn){let r;const a=et.getTransfer(s);if(n===pn)return i.UNSIGNED_BYTE;if(n===Xa)return i.UNSIGNED_SHORT_4_4_4_4;if(n===Ya)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Gl)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===kl)return i.BYTE;if(n===Hl)return i.SHORT;if(n===qi)return i.UNSIGNED_SHORT;if(n===Wa)return i.INT;if(n===Yn)return i.UNSIGNED_INT;if(n===un)return i.FLOAT;if(n===ji)return i.HALF_FLOAT;if(n===Vl)return i.ALPHA;if(n===Wl)return i.RGB;if(n===Kt)return i.RGBA;if(n===Xl)return i.LUMINANCE;if(n===Yl)return i.LUMINANCE_ALPHA;if(n===Mi)return i.DEPTH_COMPONENT;if(n===Ri)return i.DEPTH_STENCIL;if(n===ql)return i.RED;if(n===qa)return i.RED_INTEGER;if(n===jl)return i.RG;if(n===ja)return i.RG_INTEGER;if(n===Ka)return i.RGBA_INTEGER;if(n===Ls||n===Ds||n===Is||n===Ns)if(a===at)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Ls)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Ds)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Is)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Ns)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Ls)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Ds)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Is)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Ns)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===da||n===fa||n===pa||n===ma)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===da)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===fa)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===pa)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===ma)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===_a||n===ga||n===va)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===_a||n===ga)return a===at?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===va)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===xa||n===Ma||n===Sa||n===ya||n===Ea||n===ba||n===Ta||n===Aa||n===wa||n===Ra||n===Ca||n===Pa||n===La||n===Da)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===xa)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Ma)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Sa)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===ya)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===Ea)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===ba)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Ta)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Aa)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===wa)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Ra)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Ca)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Pa)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===La)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Da)return a===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Us||n===Ia||n===Na)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===Us)return a===at?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Ia)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Na)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Kl||n===Ua||n===Fa||n===Oa)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===Us)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Ua)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Fa)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Oa)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===wi?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}class Rm extends Bt{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class An extends gt{constructor(){super(),this.isGroup=!0,this.type="Group"}}const Cm={type:"move"};class Gr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new An,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new An,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new O,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new O),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new An,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new O,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new O),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,a=null;const o=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(const M of e.hand.values()){const f=t.getJointPose(M,n),d=this._getHandJoint(c,M);f!==null&&(d.matrix.fromArray(f.transform.matrix),d.matrix.decompose(d.position,d.rotation,d.scale),d.matrixWorldNeedsUpdate=!0,d.jointRadius=f.radius),d.visible=f!==null}const h=c.joints["index-finger-tip"],m=c.joints["thumb-tip"],p=h.position.distanceTo(m.position),u=.02,_=.005;c.inputState.pinching&&p>u+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&p<=u-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));o!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(o.matrix.fromArray(s.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,s.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(s.linearVelocity)):o.hasLinearVelocity=!1,s.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(s.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(Cm)))}return o!==null&&(o.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new An;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}const Pm=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Lm=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class Dm{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){const s=new Rt,r=e.properties.get(s);r.__webglTexture=t.texture,(t.depthNear!=n.depthNear||t.depthFar!=n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=s}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,n=new Dn({vertexShader:Pm,fragmentShader:Lm,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new kt(new ir(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class Im extends $n{constructor(e,t){super();const n=this;let s=null,r=1,a=null,o="local-floor",l=1,c=null,h=null,m=null,p=null,u=null,_=null;const M=new Dm,f=t.getContextAttributes();let d=null,E=null;const S=[],T=[],z=new Ue;let D=null;const A=new Bt;A.layers.enable(1),A.viewport=new ct;const B=new Bt;B.layers.enable(2),B.viewport=new ct;const ie=[A,B],g=new Rm;g.layers.enable(1),g.layers.enable(2);let y=null,W=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(j){let ae=S[j];return ae===void 0&&(ae=new Gr,S[j]=ae),ae.getTargetRaySpace()},this.getControllerGrip=function(j){let ae=S[j];return ae===void 0&&(ae=new Gr,S[j]=ae),ae.getGripSpace()},this.getHand=function(j){let ae=S[j];return ae===void 0&&(ae=new Gr,S[j]=ae),ae.getHandSpace()};function H(j){const ae=T.indexOf(j.inputSource);if(ae===-1)return;const Ee=S[ae];Ee!==void 0&&(Ee.update(j.inputSource,j.frame,c||a),Ee.dispatchEvent({type:j.type,data:j.inputSource}))}function Q(){s.removeEventListener("select",H),s.removeEventListener("selectstart",H),s.removeEventListener("selectend",H),s.removeEventListener("squeeze",H),s.removeEventListener("squeezestart",H),s.removeEventListener("squeezeend",H),s.removeEventListener("end",Q),s.removeEventListener("inputsourceschange",re);for(let j=0;j<S.length;j++){const ae=T[j];ae!==null&&(T[j]=null,S[j].disconnect(ae))}y=null,W=null,M.reset(),e.setRenderTarget(d),u=null,p=null,m=null,s=null,E=null,Be.stop(),n.isPresenting=!1,e.setPixelRatio(D),e.setSize(z.width,z.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(j){r=j,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(j){o=j,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(j){c=j},this.getBaseLayer=function(){return p!==null?p:u},this.getBinding=function(){return m},this.getFrame=function(){return _},this.getSession=function(){return s},this.setSession=async function(j){if(s=j,s!==null){if(d=e.getRenderTarget(),s.addEventListener("select",H),s.addEventListener("selectstart",H),s.addEventListener("selectend",H),s.addEventListener("squeeze",H),s.addEventListener("squeezestart",H),s.addEventListener("squeezeend",H),s.addEventListener("end",Q),s.addEventListener("inputsourceschange",re),f.xrCompatible!==!0&&await t.makeXRCompatible(),D=e.getPixelRatio(),e.getSize(z),s.renderState.layers===void 0){const ae={antialias:f.antialias,alpha:!0,depth:f.depth,stencil:f.stencil,framebufferScaleFactor:r};u=new XRWebGLLayer(s,t,ae),s.updateRenderState({baseLayer:u}),e.setPixelRatio(1),e.setSize(u.framebufferWidth,u.framebufferHeight,!1),E=new qn(u.framebufferWidth,u.framebufferHeight,{format:Kt,type:pn,colorSpace:e.outputColorSpace,stencilBuffer:f.stencil})}else{let ae=null,Ee=null,Se=null;f.depth&&(Se=f.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ae=f.stencil?Ri:Mi,Ee=f.stencil?wi:Yn);const Oe={colorFormat:t.RGBA8,depthFormat:Se,scaleFactor:r};m=new XRWebGLBinding(s,t),p=m.createProjectionLayer(Oe),s.updateRenderState({layers:[p]}),e.setPixelRatio(1),e.setSize(p.textureWidth,p.textureHeight,!1),E=new qn(p.textureWidth,p.textureHeight,{format:Kt,type:pn,depthTexture:new cc(p.textureWidth,p.textureHeight,Ee,void 0,void 0,void 0,void 0,void 0,void 0,ae),stencilBuffer:f.stencil,colorSpace:e.outputColorSpace,samples:f.antialias?4:0,resolveDepthBuffer:p.ignoreDepthValues===!1})}E.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await s.requestReferenceSpace(o),Be.setContext(s),Be.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return M.getDepthTexture()};function re(j){for(let ae=0;ae<j.removed.length;ae++){const Ee=j.removed[ae],Se=T.indexOf(Ee);Se>=0&&(T[Se]=null,S[Se].disconnect(Ee))}for(let ae=0;ae<j.added.length;ae++){const Ee=j.added[ae];let Se=T.indexOf(Ee);if(Se===-1){for(let Le=0;Le<S.length;Le++)if(Le>=T.length){T.push(Ee),Se=Le;break}else if(T[Le]===null){T[Le]=Ee,Se=Le;break}if(Se===-1)break}const Oe=S[Se];Oe&&Oe.connect(Ee)}}const Y=new O,ne=new O;function V(j,ae,Ee){Y.setFromMatrixPosition(ae.matrixWorld),ne.setFromMatrixPosition(Ee.matrixWorld);const Se=Y.distanceTo(ne),Oe=ae.projectionMatrix.elements,Le=Ee.projectionMatrix.elements,qe=Oe[14]/(Oe[10]-1),$e=Oe[14]/(Oe[10]+1),We=(Oe[9]+1)/Oe[5],P=(Oe[9]-1)/Oe[5],vt=(Oe[8]-1)/Oe[0],Ve=(Le[8]+1)/Le[0],je=qe*vt,De=qe*Ve,tt=Se/(-vt+Ve),Ne=tt*-vt;if(ae.matrixWorld.decompose(j.position,j.quaternion,j.scale),j.translateX(Ne),j.translateZ(tt),j.matrixWorld.compose(j.position,j.quaternion,j.scale),j.matrixWorldInverse.copy(j.matrixWorld).invert(),Oe[10]===-1)j.projectionMatrix.copy(ae.projectionMatrix),j.projectionMatrixInverse.copy(ae.projectionMatrixInverse);else{const b=qe+tt,x=$e+tt,k=je-Ne,q=De+(Se-Ne),se=We*$e/x*b,Z=P*$e/x*b;j.projectionMatrix.makePerspective(k,q,se,Z,b,x),j.projectionMatrixInverse.copy(j.projectionMatrix).invert()}}function ve(j,ae){ae===null?j.matrixWorld.copy(j.matrix):j.matrixWorld.multiplyMatrices(ae.matrixWorld,j.matrix),j.matrixWorldInverse.copy(j.matrixWorld).invert()}this.updateCamera=function(j){if(s===null)return;let ae=j.near,Ee=j.far;M.texture!==null&&(M.depthNear>0&&(ae=M.depthNear),M.depthFar>0&&(Ee=M.depthFar)),g.near=B.near=A.near=ae,g.far=B.far=A.far=Ee,(y!==g.near||W!==g.far)&&(s.updateRenderState({depthNear:g.near,depthFar:g.far}),y=g.near,W=g.far);const Se=j.parent,Oe=g.cameras;ve(g,Se);for(let Le=0;Le<Oe.length;Le++)ve(Oe[Le],Se);Oe.length===2?V(g,A,B):g.projectionMatrix.copy(A.projectionMatrix),Me(j,g,Se)};function Me(j,ae,Ee){Ee===null?j.matrix.copy(ae.matrixWorld):(j.matrix.copy(Ee.matrixWorld),j.matrix.invert(),j.matrix.multiply(ae.matrixWorld)),j.matrix.decompose(j.position,j.quaternion,j.scale),j.updateMatrixWorld(!0),j.projectionMatrix.copy(ae.projectionMatrix),j.projectionMatrixInverse.copy(ae.projectionMatrixInverse),j.isPerspectiveCamera&&(j.fov=Ba*2*Math.atan(1/j.projectionMatrix.elements[5]),j.zoom=1)}this.getCamera=function(){return g},this.getFoveation=function(){if(!(p===null&&u===null))return l},this.setFoveation=function(j){l=j,p!==null&&(p.fixedFoveation=j),u!==null&&u.fixedFoveation!==void 0&&(u.fixedFoveation=j)},this.hasDepthSensing=function(){return M.texture!==null},this.getDepthSensingMesh=function(){return M.getMesh(g)};let ye=null;function ze(j,ae){if(h=ae.getViewerPose(c||a),_=ae,h!==null){const Ee=h.views;u!==null&&(e.setRenderTargetFramebuffer(E,u.framebuffer),e.setRenderTarget(E));let Se=!1;Ee.length!==g.cameras.length&&(g.cameras.length=0,Se=!0);for(let Le=0;Le<Ee.length;Le++){const qe=Ee[Le];let $e=null;if(u!==null)$e=u.getViewport(qe);else{const P=m.getViewSubImage(p,qe);$e=P.viewport,Le===0&&(e.setRenderTargetTextures(E,P.colorTexture,p.ignoreDepthValues?void 0:P.depthStencilTexture),e.setRenderTarget(E))}let We=ie[Le];We===void 0&&(We=new Bt,We.layers.enable(Le),We.viewport=new ct,ie[Le]=We),We.matrix.fromArray(qe.transform.matrix),We.matrix.decompose(We.position,We.quaternion,We.scale),We.projectionMatrix.fromArray(qe.projectionMatrix),We.projectionMatrixInverse.copy(We.projectionMatrix).invert(),We.viewport.set($e.x,$e.y,$e.width,$e.height),Le===0&&(g.matrix.copy(We.matrix),g.matrix.decompose(g.position,g.quaternion,g.scale)),Se===!0&&g.cameras.push(We)}const Oe=s.enabledFeatures;if(Oe&&Oe.includes("depth-sensing")){const Le=m.getDepthInformation(Ee[0]);Le&&Le.isValid&&Le.texture&&M.init(e,Le,s.renderState)}}for(let Ee=0;Ee<S.length;Ee++){const Se=T[Ee],Oe=S[Ee];Se!==null&&Oe!==void 0&&Oe.update(Se,ae,c||a)}ye&&ye(j,ae),ae.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ae}),_=null}const Be=new oc;Be.setAnimationLoop(ze),this.setAnimationLoop=function(j){ye=j},this.dispose=function(){}}}const zn=new tn,Nm=new st;function Um(i,e){function t(f,d){f.matrixAutoUpdate===!0&&f.updateMatrix(),d.value.copy(f.matrix)}function n(f,d){d.color.getRGB(f.fogColor.value,sc(i)),d.isFog?(f.fogNear.value=d.near,f.fogFar.value=d.far):d.isFogExp2&&(f.fogDensity.value=d.density)}function s(f,d,E,S,T){d.isMeshBasicMaterial||d.isMeshLambertMaterial?r(f,d):d.isMeshToonMaterial?(r(f,d),m(f,d)):d.isMeshPhongMaterial?(r(f,d),h(f,d)):d.isMeshStandardMaterial?(r(f,d),p(f,d),d.isMeshPhysicalMaterial&&u(f,d,T)):d.isMeshMatcapMaterial?(r(f,d),_(f,d)):d.isMeshDepthMaterial?r(f,d):d.isMeshDistanceMaterial?(r(f,d),M(f,d)):d.isMeshNormalMaterial?r(f,d):d.isLineBasicMaterial?(a(f,d),d.isLineDashedMaterial&&o(f,d)):d.isPointsMaterial?l(f,d,E,S):d.isSpriteMaterial?c(f,d):d.isShadowMaterial?(f.color.value.copy(d.color),f.opacity.value=d.opacity):d.isShaderMaterial&&(d.uniformsNeedUpdate=!1)}function r(f,d){f.opacity.value=d.opacity,d.color&&f.diffuse.value.copy(d.color),d.emissive&&f.emissive.value.copy(d.emissive).multiplyScalar(d.emissiveIntensity),d.map&&(f.map.value=d.map,t(d.map,f.mapTransform)),d.alphaMap&&(f.alphaMap.value=d.alphaMap,t(d.alphaMap,f.alphaMapTransform)),d.bumpMap&&(f.bumpMap.value=d.bumpMap,t(d.bumpMap,f.bumpMapTransform),f.bumpScale.value=d.bumpScale,d.side===wt&&(f.bumpScale.value*=-1)),d.normalMap&&(f.normalMap.value=d.normalMap,t(d.normalMap,f.normalMapTransform),f.normalScale.value.copy(d.normalScale),d.side===wt&&f.normalScale.value.negate()),d.displacementMap&&(f.displacementMap.value=d.displacementMap,t(d.displacementMap,f.displacementMapTransform),f.displacementScale.value=d.displacementScale,f.displacementBias.value=d.displacementBias),d.emissiveMap&&(f.emissiveMap.value=d.emissiveMap,t(d.emissiveMap,f.emissiveMapTransform)),d.specularMap&&(f.specularMap.value=d.specularMap,t(d.specularMap,f.specularMapTransform)),d.alphaTest>0&&(f.alphaTest.value=d.alphaTest);const E=e.get(d),S=E.envMap,T=E.envMapRotation;S&&(f.envMap.value=S,zn.copy(T),zn.x*=-1,zn.y*=-1,zn.z*=-1,S.isCubeTexture&&S.isRenderTargetTexture===!1&&(zn.y*=-1,zn.z*=-1),f.envMapRotation.value.setFromMatrix4(Nm.makeRotationFromEuler(zn)),f.flipEnvMap.value=S.isCubeTexture&&S.isRenderTargetTexture===!1?-1:1,f.reflectivity.value=d.reflectivity,f.ior.value=d.ior,f.refractionRatio.value=d.refractionRatio),d.lightMap&&(f.lightMap.value=d.lightMap,f.lightMapIntensity.value=d.lightMapIntensity,t(d.lightMap,f.lightMapTransform)),d.aoMap&&(f.aoMap.value=d.aoMap,f.aoMapIntensity.value=d.aoMapIntensity,t(d.aoMap,f.aoMapTransform))}function a(f,d){f.diffuse.value.copy(d.color),f.opacity.value=d.opacity,d.map&&(f.map.value=d.map,t(d.map,f.mapTransform))}function o(f,d){f.dashSize.value=d.dashSize,f.totalSize.value=d.dashSize+d.gapSize,f.scale.value=d.scale}function l(f,d,E,S){f.diffuse.value.copy(d.color),f.opacity.value=d.opacity,f.size.value=d.size*E,f.scale.value=S*.5,d.map&&(f.map.value=d.map,t(d.map,f.uvTransform)),d.alphaMap&&(f.alphaMap.value=d.alphaMap,t(d.alphaMap,f.alphaMapTransform)),d.alphaTest>0&&(f.alphaTest.value=d.alphaTest)}function c(f,d){f.diffuse.value.copy(d.color),f.opacity.value=d.opacity,f.rotation.value=d.rotation,d.map&&(f.map.value=d.map,t(d.map,f.mapTransform)),d.alphaMap&&(f.alphaMap.value=d.alphaMap,t(d.alphaMap,f.alphaMapTransform)),d.alphaTest>0&&(f.alphaTest.value=d.alphaTest)}function h(f,d){f.specular.value.copy(d.specular),f.shininess.value=Math.max(d.shininess,1e-4)}function m(f,d){d.gradientMap&&(f.gradientMap.value=d.gradientMap)}function p(f,d){f.metalness.value=d.metalness,d.metalnessMap&&(f.metalnessMap.value=d.metalnessMap,t(d.metalnessMap,f.metalnessMapTransform)),f.roughness.value=d.roughness,d.roughnessMap&&(f.roughnessMap.value=d.roughnessMap,t(d.roughnessMap,f.roughnessMapTransform)),d.envMap&&(f.envMapIntensity.value=d.envMapIntensity)}function u(f,d,E){f.ior.value=d.ior,d.sheen>0&&(f.sheenColor.value.copy(d.sheenColor).multiplyScalar(d.sheen),f.sheenRoughness.value=d.sheenRoughness,d.sheenColorMap&&(f.sheenColorMap.value=d.sheenColorMap,t(d.sheenColorMap,f.sheenColorMapTransform)),d.sheenRoughnessMap&&(f.sheenRoughnessMap.value=d.sheenRoughnessMap,t(d.sheenRoughnessMap,f.sheenRoughnessMapTransform))),d.clearcoat>0&&(f.clearcoat.value=d.clearcoat,f.clearcoatRoughness.value=d.clearcoatRoughness,d.clearcoatMap&&(f.clearcoatMap.value=d.clearcoatMap,t(d.clearcoatMap,f.clearcoatMapTransform)),d.clearcoatRoughnessMap&&(f.clearcoatRoughnessMap.value=d.clearcoatRoughnessMap,t(d.clearcoatRoughnessMap,f.clearcoatRoughnessMapTransform)),d.clearcoatNormalMap&&(f.clearcoatNormalMap.value=d.clearcoatNormalMap,t(d.clearcoatNormalMap,f.clearcoatNormalMapTransform),f.clearcoatNormalScale.value.copy(d.clearcoatNormalScale),d.side===wt&&f.clearcoatNormalScale.value.negate())),d.dispersion>0&&(f.dispersion.value=d.dispersion),d.iridescence>0&&(f.iridescence.value=d.iridescence,f.iridescenceIOR.value=d.iridescenceIOR,f.iridescenceThicknessMinimum.value=d.iridescenceThicknessRange[0],f.iridescenceThicknessMaximum.value=d.iridescenceThicknessRange[1],d.iridescenceMap&&(f.iridescenceMap.value=d.iridescenceMap,t(d.iridescenceMap,f.iridescenceMapTransform)),d.iridescenceThicknessMap&&(f.iridescenceThicknessMap.value=d.iridescenceThicknessMap,t(d.iridescenceThicknessMap,f.iridescenceThicknessMapTransform))),d.transmission>0&&(f.transmission.value=d.transmission,f.transmissionSamplerMap.value=E.texture,f.transmissionSamplerSize.value.set(E.width,E.height),d.transmissionMap&&(f.transmissionMap.value=d.transmissionMap,t(d.transmissionMap,f.transmissionMapTransform)),f.thickness.value=d.thickness,d.thicknessMap&&(f.thicknessMap.value=d.thicknessMap,t(d.thicknessMap,f.thicknessMapTransform)),f.attenuationDistance.value=d.attenuationDistance,f.attenuationColor.value.copy(d.attenuationColor)),d.anisotropy>0&&(f.anisotropyVector.value.set(d.anisotropy*Math.cos(d.anisotropyRotation),d.anisotropy*Math.sin(d.anisotropyRotation)),d.anisotropyMap&&(f.anisotropyMap.value=d.anisotropyMap,t(d.anisotropyMap,f.anisotropyMapTransform))),f.specularIntensity.value=d.specularIntensity,f.specularColor.value.copy(d.specularColor),d.specularColorMap&&(f.specularColorMap.value=d.specularColorMap,t(d.specularColorMap,f.specularColorMapTransform)),d.specularIntensityMap&&(f.specularIntensityMap.value=d.specularIntensityMap,t(d.specularIntensityMap,f.specularIntensityMapTransform))}function _(f,d){d.matcap&&(f.matcap.value=d.matcap)}function M(f,d){const E=e.get(d).light;f.referencePosition.value.setFromMatrixPosition(E.matrixWorld),f.nearDistance.value=E.shadow.camera.near,f.farDistance.value=E.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Fm(i,e,t,n){let s={},r={},a=[];const o=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(E,S){const T=S.program;n.uniformBlockBinding(E,T)}function c(E,S){let T=s[E.id];T===void 0&&(_(E),T=h(E),s[E.id]=T,E.addEventListener("dispose",f));const z=S.program;n.updateUBOMapping(E,z);const D=e.render.frame;r[E.id]!==D&&(p(E),r[E.id]=D)}function h(E){const S=m();E.__bindingPointIndex=S;const T=i.createBuffer(),z=E.__size,D=E.usage;return i.bindBuffer(i.UNIFORM_BUFFER,T),i.bufferData(i.UNIFORM_BUFFER,z,D),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,S,T),T}function m(){for(let E=0;E<o;E++)if(a.indexOf(E)===-1)return a.push(E),E;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function p(E){const S=s[E.id],T=E.uniforms,z=E.__cache;i.bindBuffer(i.UNIFORM_BUFFER,S);for(let D=0,A=T.length;D<A;D++){const B=Array.isArray(T[D])?T[D]:[T[D]];for(let ie=0,g=B.length;ie<g;ie++){const y=B[ie];if(u(y,D,ie,z)===!0){const W=y.__offset,H=Array.isArray(y.value)?y.value:[y.value];let Q=0;for(let re=0;re<H.length;re++){const Y=H[re],ne=M(Y);typeof Y=="number"||typeof Y=="boolean"?(y.__data[0]=Y,i.bufferSubData(i.UNIFORM_BUFFER,W+Q,y.__data)):Y.isMatrix3?(y.__data[0]=Y.elements[0],y.__data[1]=Y.elements[1],y.__data[2]=Y.elements[2],y.__data[3]=0,y.__data[4]=Y.elements[3],y.__data[5]=Y.elements[4],y.__data[6]=Y.elements[5],y.__data[7]=0,y.__data[8]=Y.elements[6],y.__data[9]=Y.elements[7],y.__data[10]=Y.elements[8],y.__data[11]=0):(Y.toArray(y.__data,Q),Q+=ne.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,W,y.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function u(E,S,T,z){const D=E.value,A=S+"_"+T;if(z[A]===void 0)return typeof D=="number"||typeof D=="boolean"?z[A]=D:z[A]=D.clone(),!0;{const B=z[A];if(typeof D=="number"||typeof D=="boolean"){if(B!==D)return z[A]=D,!0}else if(B.equals(D)===!1)return B.copy(D),!0}return!1}function _(E){const S=E.uniforms;let T=0;const z=16;for(let A=0,B=S.length;A<B;A++){const ie=Array.isArray(S[A])?S[A]:[S[A]];for(let g=0,y=ie.length;g<y;g++){const W=ie[g],H=Array.isArray(W.value)?W.value:[W.value];for(let Q=0,re=H.length;Q<re;Q++){const Y=H[Q],ne=M(Y),V=T%z,ve=V%ne.boundary,Me=V+ve;T+=ve,Me!==0&&z-Me<ne.storage&&(T+=z-Me),W.__data=new Float32Array(ne.storage/Float32Array.BYTES_PER_ELEMENT),W.__offset=T,T+=ne.storage}}}const D=T%z;return D>0&&(T+=z-D),E.__size=T,E.__cache={},this}function M(E){const S={boundary:0,storage:0};return typeof E=="number"||typeof E=="boolean"?(S.boundary=4,S.storage=4):E.isVector2?(S.boundary=8,S.storage=8):E.isVector3||E.isColor?(S.boundary=16,S.storage=12):E.isVector4?(S.boundary=16,S.storage=16):E.isMatrix3?(S.boundary=48,S.storage=48):E.isMatrix4?(S.boundary=64,S.storage=64):E.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",E),S}function f(E){const S=E.target;S.removeEventListener("dispose",f);const T=a.indexOf(S.__bindingPointIndex);a.splice(T,1),i.deleteBuffer(s[S.id]),delete s[S.id],delete r[S.id]}function d(){for(const E in s)i.deleteBuffer(s[E]);a=[],s={},r={}}return{bind:l,update:c,dispose:d}}class Om{constructor(e={}){const{canvas:t=Eh(),context:n=null,depth:s=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:m=!1}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=a;const u=new Uint32Array(4),_=new Int32Array(4);let M=null,f=null;const d=[],E=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=Zt,this.toneMapping=Pn,this.toneMappingExposure=1;const S=this;let T=!1,z=0,D=0,A=null,B=-1,ie=null;const g=new ct,y=new ct;let W=null;const H=new Ye(0);let Q=0,re=t.width,Y=t.height,ne=1,V=null,ve=null;const Me=new ct(0,0,re,Y),ye=new ct(0,0,re,Y);let ze=!1;const Be=new Qa;let j=!1,ae=!1;const Ee=new st,Se=new st,Oe=new O,Le=new ct,qe={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let $e=!1;function We(){return A===null?ne:1}let P=n;function vt(v,R){return t.getContext(v,R)}try{const v={alpha:!0,depth:s,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:m};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Va}`),t.addEventListener("webglcontextlost",te,!1),t.addEventListener("webglcontextrestored",de,!1),t.addEventListener("webglcontextcreationerror",_e,!1),P===null){const R="webgl2";if(P=vt(R,v),P===null)throw vt(R)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(v){throw console.error("THREE.WebGLRenderer: "+v.message),v}let Ve,je,De,tt,Ne,b,x,k,q,se,Z,be,he,xe,Fe,oe,fe,Pe,Ae,pe,ke,Ie,nt,N;function me(){Ve=new Gf(P),Ve.init(),Ie=new wm(P,Ve),je=new Ff(P,Ve,e,Ie),De=new bm(P),je.reverseDepthBuffer&&De.buffers.depth.setReversed(!0),tt=new Xf(P),Ne=new cm,b=new Am(P,Ve,De,Ne,je,Ie,tt),x=new Bf(S),k=new Hf(S),q=new Zh(P),nt=new Nf(P,q),se=new Vf(P,q,tt,nt),Z=new qf(P,se,q,tt),Ae=new Yf(P,je,b),oe=new Of(Ne),be=new lm(S,x,k,Ve,je,nt,oe),he=new Um(S,Ne),xe=new um,Fe=new gm(Ve),Pe=new If(S,x,k,De,Z,p,l),fe=new ym(S,Z,je),N=new Fm(P,tt,je,De),pe=new Uf(P,Ve,tt),ke=new Wf(P,Ve,tt),tt.programs=be.programs,S.capabilities=je,S.extensions=Ve,S.properties=Ne,S.renderLists=xe,S.shadowMap=fe,S.state=De,S.info=tt}me();const G=new Im(S,P);this.xr=G,this.getContext=function(){return P},this.getContextAttributes=function(){return P.getContextAttributes()},this.forceContextLoss=function(){const v=Ve.get("WEBGL_lose_context");v&&v.loseContext()},this.forceContextRestore=function(){const v=Ve.get("WEBGL_lose_context");v&&v.restoreContext()},this.getPixelRatio=function(){return ne},this.setPixelRatio=function(v){v!==void 0&&(ne=v,this.setSize(re,Y,!1))},this.getSize=function(v){return v.set(re,Y)},this.setSize=function(v,R,L=!0){if(G.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}re=v,Y=R,t.width=Math.floor(v*ne),t.height=Math.floor(R*ne),L===!0&&(t.style.width=v+"px",t.style.height=R+"px"),this.setViewport(0,0,v,R)},this.getDrawingBufferSize=function(v){return v.set(re*ne,Y*ne).floor()},this.setDrawingBufferSize=function(v,R,L){re=v,Y=R,ne=L,t.width=Math.floor(v*L),t.height=Math.floor(R*L),this.setViewport(0,0,v,R)},this.getCurrentViewport=function(v){return v.copy(g)},this.getViewport=function(v){return v.copy(Me)},this.setViewport=function(v,R,L,I){v.isVector4?Me.set(v.x,v.y,v.z,v.w):Me.set(v,R,L,I),De.viewport(g.copy(Me).multiplyScalar(ne).round())},this.getScissor=function(v){return v.copy(ye)},this.setScissor=function(v,R,L,I){v.isVector4?ye.set(v.x,v.y,v.z,v.w):ye.set(v,R,L,I),De.scissor(y.copy(ye).multiplyScalar(ne).round())},this.getScissorTest=function(){return ze},this.setScissorTest=function(v){De.setScissorTest(ze=v)},this.setOpaqueSort=function(v){V=v},this.setTransparentSort=function(v){ve=v},this.getClearColor=function(v){return v.copy(Pe.getClearColor())},this.setClearColor=function(){Pe.setClearColor.apply(Pe,arguments)},this.getClearAlpha=function(){return Pe.getClearAlpha()},this.setClearAlpha=function(){Pe.setClearAlpha.apply(Pe,arguments)},this.clear=function(v=!0,R=!0,L=!0){let I=0;if(v){let C=!1;if(A!==null){const K=A.texture.format;C=K===Ka||K===ja||K===qa}if(C){const K=A.texture.type,$=K===pn||K===Yn||K===qi||K===wi||K===Xa||K===Ya,ee=Pe.getClearColor(),ce=Pe.getClearAlpha(),we=ee.r,Re=ee.g,Te=ee.b;$?(u[0]=we,u[1]=Re,u[2]=Te,u[3]=ce,P.clearBufferuiv(P.COLOR,0,u)):(_[0]=we,_[1]=Re,_[2]=Te,_[3]=ce,P.clearBufferiv(P.COLOR,0,_))}else I|=P.COLOR_BUFFER_BIT}R&&(I|=P.DEPTH_BUFFER_BIT,P.clearDepth(this.capabilities.reverseDepthBuffer?0:1)),L&&(I|=P.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),P.clear(I)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",te,!1),t.removeEventListener("webglcontextrestored",de,!1),t.removeEventListener("webglcontextcreationerror",_e,!1),xe.dispose(),Fe.dispose(),Ne.dispose(),x.dispose(),k.dispose(),Z.dispose(),nt.dispose(),N.dispose(),be.dispose(),G.dispose(),G.removeEventListener("sessionstart",es),G.removeEventListener("sessionend",ts),nn.stop()};function te(v){v.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),T=!0}function de(){console.log("THREE.WebGLRenderer: Context Restored."),T=!1;const v=tt.autoReset,R=fe.enabled,L=fe.autoUpdate,I=fe.needsUpdate,C=fe.type;me(),tt.autoReset=v,fe.enabled=R,fe.autoUpdate=L,fe.needsUpdate=I,fe.type=C}function _e(v){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",v.statusMessage)}function Xe(v){const R=v.target;R.removeEventListener("dispose",Xe),ot(R)}function ot(v){Mt(v),Ne.remove(v)}function Mt(v){const R=Ne.get(v).programs;R!==void 0&&(R.forEach(function(L){be.releaseProgram(L)}),v.isShaderMaterial&&be.releaseShaderCache(v))}this.renderBufferDirect=function(v,R,L,I,C,K){R===null&&(R=qe);const $=C.isMesh&&C.matrixWorld.determinant()<0,ee=le(v,R,L,I,C);De.setMaterial(I,$);let ce=L.index,we=1;if(I.wireframe===!0){if(ce=se.getWireframeAttribute(L),ce===void 0)return;we=2}const Re=L.drawRange,Te=L.attributes.position;let Ze=Re.start*we,rt=(Re.start+Re.count)*we;K!==null&&(Ze=Math.max(Ze,K.start*we),rt=Math.min(rt,(K.start+K.count)*we)),ce!==null?(Ze=Math.max(Ze,0),rt=Math.min(rt,ce.count)):Te!=null&&(Ze=Math.max(Ze,0),rt=Math.min(rt,Te.count));const lt=rt-Ze;if(lt<0||lt===1/0)return;nt.setup(C,I,ee,L,ce);let Pt,Je=pe;if(ce!==null&&(Pt=q.get(ce),Je=ke,Je.setIndex(Pt)),C.isMesh)I.wireframe===!0?(De.setLineWidth(I.wireframeLinewidth*We()),Je.setMode(P.LINES)):Je.setMode(P.TRIANGLES);else if(C.isLine){let Ce=I.linewidth;Ce===void 0&&(Ce=1),De.setLineWidth(Ce*We()),C.isLineSegments?Je.setMode(P.LINES):C.isLineLoop?Je.setMode(P.LINE_LOOP):Je.setMode(P.LINE_STRIP)}else C.isPoints?Je.setMode(P.POINTS):C.isSprite&&Je.setMode(P.TRIANGLES);if(C.isBatchedMesh)if(C._multiDrawInstances!==null)Je.renderMultiDrawInstances(C._multiDrawStarts,C._multiDrawCounts,C._multiDrawCount,C._multiDrawInstances);else if(Ve.get("WEBGL_multi_draw"))Je.renderMultiDraw(C._multiDrawStarts,C._multiDrawCounts,C._multiDrawCount);else{const Ce=C._multiDrawStarts,xt=C._multiDrawCounts,Qe=C._multiDrawCount,Vt=ce?q.get(ce).bytesPerElement:1,Qn=Ne.get(I).currentProgram.getUniforms();for(let Lt=0;Lt<Qe;Lt++)Qn.setValue(P,"_gl_DrawID",Lt),Je.render(Ce[Lt]/Vt,xt[Lt])}else if(C.isInstancedMesh)Je.renderInstances(Ze,lt,C.count);else if(L.isInstancedBufferGeometry){const Ce=L._maxInstanceCount!==void 0?L._maxInstanceCount:1/0,xt=Math.min(L.instanceCount,Ce);Je.renderInstances(Ze,lt,xt)}else Je.render(Ze,lt)};function Ke(v,R,L){v.transparent===!0&&v.side===hn&&v.forceSinglePass===!1?(v.side=wt,v.needsUpdate=!0,U(v,R,L),v.side=Ln,v.needsUpdate=!0,U(v,R,L),v.side=hn):U(v,R,L)}this.compile=function(v,R,L=null){L===null&&(L=v),f=Fe.get(L),f.init(R),E.push(f),L.traverseVisible(function(C){C.isLight&&C.layers.test(R.layers)&&(f.pushLight(C),C.castShadow&&f.pushShadow(C))}),v!==L&&v.traverseVisible(function(C){C.isLight&&C.layers.test(R.layers)&&(f.pushLight(C),C.castShadow&&f.pushShadow(C))}),f.setupLights();const I=new Set;return v.traverse(function(C){if(!(C.isMesh||C.isPoints||C.isLine||C.isSprite))return;const K=C.material;if(K)if(Array.isArray(K))for(let $=0;$<K.length;$++){const ee=K[$];Ke(ee,L,C),I.add(ee)}else Ke(K,L,C),I.add(K)}),E.pop(),f=null,I},this.compileAsync=function(v,R,L=null){const I=this.compile(v,R,L);return new Promise(C=>{function K(){if(I.forEach(function($){Ne.get($).currentProgram.isReady()&&I.delete($)}),I.size===0){C(v);return}setTimeout(K,10)}Ve.get("KHR_parallel_shader_compile")!==null?K():setTimeout(K,10)})};let dt=null;function Gt(v){dt&&dt(v)}function es(){nn.stop()}function ts(){nn.start()}const nn=new oc;nn.setAnimationLoop(Gt),typeof self<"u"&&nn.setContext(self),this.setAnimationLoop=function(v){dt=v,G.setAnimationLoop(v),v===null?nn.stop():nn.start()},G.addEventListener("sessionstart",es),G.addEventListener("sessionend",ts),this.render=function(v,R){if(R!==void 0&&R.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(T===!0)return;if(v.matrixWorldAutoUpdate===!0&&v.updateMatrixWorld(),R.parent===null&&R.matrixWorldAutoUpdate===!0&&R.updateMatrixWorld(),G.enabled===!0&&G.isPresenting===!0&&(G.cameraAutoUpdate===!0&&G.updateCamera(R),R=G.getCamera()),v.isScene===!0&&v.onBeforeRender(S,v,R,A),f=Fe.get(v,E.length),f.init(R),E.push(f),Se.multiplyMatrices(R.projectionMatrix,R.matrixWorldInverse),Be.setFromProjectionMatrix(Se),ae=this.localClippingEnabled,j=oe.init(this.clippingPlanes,ae),M=xe.get(v,d.length),M.init(),d.push(M),G.enabled===!0&&G.isPresenting===!0){const K=S.xr.getDepthSensingMesh();K!==null&&Ii(K,R,-1/0,S.sortObjects)}Ii(v,R,0,S.sortObjects),M.finish(),S.sortObjects===!0&&M.sort(V,ve),$e=G.enabled===!1||G.isPresenting===!1||G.hasDepthSensing()===!1,$e&&Pe.addToRenderList(M,v),this.info.render.frame++,j===!0&&oe.beginShadows();const L=f.state.shadowsArray;fe.render(L,v,R),j===!0&&oe.endShadows(),this.info.autoReset===!0&&this.info.reset();const I=M.opaque,C=M.transmissive;if(f.setupLights(),R.isArrayCamera){const K=R.cameras;if(C.length>0)for(let $=0,ee=K.length;$<ee;$++){const ce=K[$];is(I,C,v,ce)}$e&&Pe.render(v);for(let $=0,ee=K.length;$<ee;$++){const ce=K[$];ns(M,v,ce,ce.viewport)}}else C.length>0&&is(I,C,v,R),$e&&Pe.render(v),ns(M,v,R);A!==null&&(b.updateMultisampleRenderTarget(A),b.updateRenderTargetMipmap(A)),v.isScene===!0&&v.onAfterRender(S,v,R),nt.resetDefaultState(),B=-1,ie=null,E.pop(),E.length>0?(f=E[E.length-1],j===!0&&oe.setGlobalState(S.clippingPlanes,f.state.camera)):f=null,d.pop(),d.length>0?M=d[d.length-1]:M=null};function Ii(v,R,L,I){if(v.visible===!1)return;if(v.layers.test(R.layers)){if(v.isGroup)L=v.renderOrder;else if(v.isLOD)v.autoUpdate===!0&&v.update(R);else if(v.isLight)f.pushLight(v),v.castShadow&&f.pushShadow(v);else if(v.isSprite){if(!v.frustumCulled||Be.intersectsSprite(v)){I&&Le.setFromMatrixPosition(v.matrixWorld).applyMatrix4(Se);const $=Z.update(v),ee=v.material;ee.visible&&M.push(v,$,ee,L,Le.z,null)}}else if((v.isMesh||v.isLine||v.isPoints)&&(!v.frustumCulled||Be.intersectsObject(v))){const $=Z.update(v),ee=v.material;if(I&&(v.boundingSphere!==void 0?(v.boundingSphere===null&&v.computeBoundingSphere(),Le.copy(v.boundingSphere.center)):($.boundingSphere===null&&$.computeBoundingSphere(),Le.copy($.boundingSphere.center)),Le.applyMatrix4(v.matrixWorld).applyMatrix4(Se)),Array.isArray(ee)){const ce=$.groups;for(let we=0,Re=ce.length;we<Re;we++){const Te=ce[we],Ze=ee[Te.materialIndex];Ze&&Ze.visible&&M.push(v,$,Ze,L,Le.z,Te)}}else ee.visible&&M.push(v,$,ee,L,Le.z,null)}}const K=v.children;for(let $=0,ee=K.length;$<ee;$++)Ii(K[$],R,L,I)}function ns(v,R,L,I){const C=v.opaque,K=v.transmissive,$=v.transparent;f.setupLightsView(L),j===!0&&oe.setGlobalState(S.clippingPlanes,L),I&&De.viewport(g.copy(I)),C.length>0&&Jn(C,R,L),K.length>0&&Jn(K,R,L),$.length>0&&Jn($,R,L),De.buffers.depth.setTest(!0),De.buffers.depth.setMask(!0),De.buffers.color.setMask(!0),De.setPolygonOffset(!1)}function is(v,R,L,I){if((L.isScene===!0?L.overrideMaterial:null)!==null)return;f.state.transmissionRenderTarget[I.id]===void 0&&(f.state.transmissionRenderTarget[I.id]=new qn(1,1,{generateMipmaps:!0,type:Ve.has("EXT_color_buffer_half_float")||Ve.has("EXT_color_buffer_float")?ji:pn,minFilter:Xn,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:et.workingColorSpace}));const K=f.state.transmissionRenderTarget[I.id],$=I.viewport||g;K.setSize($.z,$.w);const ee=S.getRenderTarget();S.setRenderTarget(K),S.getClearColor(H),Q=S.getClearAlpha(),Q<1&&S.setClearColor(16777215,.5),S.clear(),$e&&Pe.render(L);const ce=S.toneMapping;S.toneMapping=Pn;const we=I.viewport;if(I.viewport!==void 0&&(I.viewport=void 0),f.setupLightsView(I),j===!0&&oe.setGlobalState(S.clippingPlanes,I),Jn(v,L,I),b.updateMultisampleRenderTarget(K),b.updateRenderTargetMipmap(K),Ve.has("WEBGL_multisampled_render_to_texture")===!1){let Re=!1;for(let Te=0,Ze=R.length;Te<Ze;Te++){const rt=R[Te],lt=rt.object,Pt=rt.geometry,Je=rt.material,Ce=rt.group;if(Je.side===hn&&lt.layers.test(I.layers)){const xt=Je.side;Je.side=wt,Je.needsUpdate=!0,w(lt,L,I,Pt,Je,Ce),Je.side=xt,Je.needsUpdate=!0,Re=!0}}Re===!0&&(b.updateMultisampleRenderTarget(K),b.updateRenderTargetMipmap(K))}S.setRenderTarget(ee),S.setClearColor(H,Q),we!==void 0&&(I.viewport=we),S.toneMapping=ce}function Jn(v,R,L){const I=R.isScene===!0?R.overrideMaterial:null;for(let C=0,K=v.length;C<K;C++){const $=v[C],ee=$.object,ce=$.geometry,we=I===null?$.material:I,Re=$.group;ee.layers.test(L.layers)&&w(ee,R,L,ce,we,Re)}}function w(v,R,L,I,C,K){v.onBeforeRender(S,R,L,I,C,K),v.modelViewMatrix.multiplyMatrices(L.matrixWorldInverse,v.matrixWorld),v.normalMatrix.getNormalMatrix(v.modelViewMatrix),C.onBeforeRender(S,R,L,I,v,K),C.transparent===!0&&C.side===hn&&C.forceSinglePass===!1?(C.side=wt,C.needsUpdate=!0,S.renderBufferDirect(L,R,I,C,v,K),C.side=Ln,C.needsUpdate=!0,S.renderBufferDirect(L,R,I,C,v,K),C.side=hn):S.renderBufferDirect(L,R,I,C,v,K),v.onAfterRender(S,R,L,I,C,K)}function U(v,R,L){R.isScene!==!0&&(R=qe);const I=Ne.get(v),C=f.state.lights,K=f.state.shadowsArray,$=C.state.version,ee=be.getParameters(v,C.state,K,R,L),ce=be.getProgramCacheKey(ee);let we=I.programs;I.environment=v.isMeshStandardMaterial?R.environment:null,I.fog=R.fog,I.envMap=(v.isMeshStandardMaterial?k:x).get(v.envMap||I.environment),I.envMapRotation=I.environment!==null&&v.envMap===null?R.environmentRotation:v.envMapRotation,we===void 0&&(v.addEventListener("dispose",Xe),we=new Map,I.programs=we);let Re=we.get(ce);if(Re!==void 0){if(I.currentProgram===Re&&I.lightsStateVersion===$)return X(v,ee),Re}else ee.uniforms=be.getUniforms(v),v.onBeforeCompile(ee,S),Re=be.acquireProgram(ee,ce),we.set(ce,Re),I.uniforms=ee.uniforms;const Te=I.uniforms;return(!v.isShaderMaterial&&!v.isRawShaderMaterial||v.clipping===!0)&&(Te.clippingPlanes=oe.uniform),X(v,ee),I.needsLights=ge(v),I.lightsStateVersion=$,I.needsLights&&(Te.ambientLightColor.value=C.state.ambient,Te.lightProbe.value=C.state.probe,Te.directionalLights.value=C.state.directional,Te.directionalLightShadows.value=C.state.directionalShadow,Te.spotLights.value=C.state.spot,Te.spotLightShadows.value=C.state.spotShadow,Te.rectAreaLights.value=C.state.rectArea,Te.ltc_1.value=C.state.rectAreaLTC1,Te.ltc_2.value=C.state.rectAreaLTC2,Te.pointLights.value=C.state.point,Te.pointLightShadows.value=C.state.pointShadow,Te.hemisphereLights.value=C.state.hemi,Te.directionalShadowMap.value=C.state.directionalShadowMap,Te.directionalShadowMatrix.value=C.state.directionalShadowMatrix,Te.spotShadowMap.value=C.state.spotShadowMap,Te.spotLightMatrix.value=C.state.spotLightMatrix,Te.spotLightMap.value=C.state.spotLightMap,Te.pointShadowMap.value=C.state.pointShadowMap,Te.pointShadowMatrix.value=C.state.pointShadowMatrix),I.currentProgram=Re,I.uniformsList=null,Re}function F(v){if(v.uniformsList===null){const R=v.currentProgram.getUniforms();v.uniformsList=Bs.seqWithValue(R.seq,v.uniforms)}return v.uniformsList}function X(v,R){const L=Ne.get(v);L.outputColorSpace=R.outputColorSpace,L.batching=R.batching,L.batchingColor=R.batchingColor,L.instancing=R.instancing,L.instancingColor=R.instancingColor,L.instancingMorph=R.instancingMorph,L.skinning=R.skinning,L.morphTargets=R.morphTargets,L.morphNormals=R.morphNormals,L.morphColors=R.morphColors,L.morphTargetsCount=R.morphTargetsCount,L.numClippingPlanes=R.numClippingPlanes,L.numIntersection=R.numClipIntersection,L.vertexAlphas=R.vertexAlphas,L.vertexTangents=R.vertexTangents,L.toneMapping=R.toneMapping}function le(v,R,L,I,C){R.isScene!==!0&&(R=qe),b.resetTextureUnits();const K=R.fog,$=I.isMeshStandardMaterial?R.environment:null,ee=A===null?S.outputColorSpace:A.isXRRenderTarget===!0?A.texture.colorSpace:In,ce=(I.isMeshStandardMaterial?k:x).get(I.envMap||$),we=I.vertexColors===!0&&!!L.attributes.color&&L.attributes.color.itemSize===4,Re=!!L.attributes.tangent&&(!!I.normalMap||I.anisotropy>0),Te=!!L.morphAttributes.position,Ze=!!L.morphAttributes.normal,rt=!!L.morphAttributes.color;let lt=Pn;I.toneMapped&&(A===null||A.isXRRenderTarget===!0)&&(lt=S.toneMapping);const Pt=L.morphAttributes.position||L.morphAttributes.normal||L.morphAttributes.color,Je=Pt!==void 0?Pt.length:0,Ce=Ne.get(I),xt=f.state.lights;if(j===!0&&(ae===!0||v!==ie)){const Ft=v===ie&&I.id===B;oe.setState(I,v,Ft)}let Qe=!1;I.version===Ce.__version?(Ce.needsLights&&Ce.lightsStateVersion!==xt.state.version||Ce.outputColorSpace!==ee||C.isBatchedMesh&&Ce.batching===!1||!C.isBatchedMesh&&Ce.batching===!0||C.isBatchedMesh&&Ce.batchingColor===!0&&C.colorTexture===null||C.isBatchedMesh&&Ce.batchingColor===!1&&C.colorTexture!==null||C.isInstancedMesh&&Ce.instancing===!1||!C.isInstancedMesh&&Ce.instancing===!0||C.isSkinnedMesh&&Ce.skinning===!1||!C.isSkinnedMesh&&Ce.skinning===!0||C.isInstancedMesh&&Ce.instancingColor===!0&&C.instanceColor===null||C.isInstancedMesh&&Ce.instancingColor===!1&&C.instanceColor!==null||C.isInstancedMesh&&Ce.instancingMorph===!0&&C.morphTexture===null||C.isInstancedMesh&&Ce.instancingMorph===!1&&C.morphTexture!==null||Ce.envMap!==ce||I.fog===!0&&Ce.fog!==K||Ce.numClippingPlanes!==void 0&&(Ce.numClippingPlanes!==oe.numPlanes||Ce.numIntersection!==oe.numIntersection)||Ce.vertexAlphas!==we||Ce.vertexTangents!==Re||Ce.morphTargets!==Te||Ce.morphNormals!==Ze||Ce.morphColors!==rt||Ce.toneMapping!==lt||Ce.morphTargetsCount!==Je)&&(Qe=!0):(Qe=!0,Ce.__version=I.version);let Vt=Ce.currentProgram;Qe===!0&&(Vt=U(I,R,C));let Qn=!1,Lt=!1,hr=!1;const ht=Vt.getUniforms(),_n=Ce.uniforms;if(De.useProgram(Vt.program)&&(Qn=!0,Lt=!0,hr=!0),I.id!==B&&(B=I.id,Lt=!0),Qn||ie!==v){je.reverseDepthBuffer?(Ee.copy(v.projectionMatrix),Th(Ee),Ah(Ee),ht.setValue(P,"projectionMatrix",Ee)):ht.setValue(P,"projectionMatrix",v.projectionMatrix),ht.setValue(P,"viewMatrix",v.matrixWorldInverse);const Ft=ht.map.cameraPosition;Ft!==void 0&&Ft.setValue(P,Oe.setFromMatrixPosition(v.matrixWorld)),je.logarithmicDepthBuffer&&ht.setValue(P,"logDepthBufFC",2/(Math.log(v.far+1)/Math.LN2)),(I.isMeshPhongMaterial||I.isMeshToonMaterial||I.isMeshLambertMaterial||I.isMeshBasicMaterial||I.isMeshStandardMaterial||I.isShaderMaterial)&&ht.setValue(P,"isOrthographic",v.isOrthographicCamera===!0),ie!==v&&(ie=v,Lt=!0,hr=!0)}if(C.isSkinnedMesh){ht.setOptional(P,C,"bindMatrix"),ht.setOptional(P,C,"bindMatrixInverse");const Ft=C.skeleton;Ft&&(Ft.boneTexture===null&&Ft.computeBoneTexture(),ht.setValue(P,"boneTexture",Ft.boneTexture,b))}C.isBatchedMesh&&(ht.setOptional(P,C,"batchingTexture"),ht.setValue(P,"batchingTexture",C._matricesTexture,b),ht.setOptional(P,C,"batchingIdTexture"),ht.setValue(P,"batchingIdTexture",C._indirectTexture,b),ht.setOptional(P,C,"batchingColorTexture"),C._colorsTexture!==null&&ht.setValue(P,"batchingColorTexture",C._colorsTexture,b));const ur=L.morphAttributes;if((ur.position!==void 0||ur.normal!==void 0||ur.color!==void 0)&&Ae.update(C,L,Vt),(Lt||Ce.receiveShadow!==C.receiveShadow)&&(Ce.receiveShadow=C.receiveShadow,ht.setValue(P,"receiveShadow",C.receiveShadow)),I.isMeshGouraudMaterial&&I.envMap!==null&&(_n.envMap.value=ce,_n.flipEnvMap.value=ce.isCubeTexture&&ce.isRenderTargetTexture===!1?-1:1),I.isMeshStandardMaterial&&I.envMap===null&&R.environment!==null&&(_n.envMapIntensity.value=R.environmentIntensity),Lt&&(ht.setValue(P,"toneMappingExposure",S.toneMappingExposure),Ce.needsLights&&J(_n,hr),K&&I.fog===!0&&he.refreshFogUniforms(_n,K),he.refreshMaterialUniforms(_n,I,ne,Y,f.state.transmissionRenderTarget[v.id]),Bs.upload(P,F(Ce),_n,b)),I.isShaderMaterial&&I.uniformsNeedUpdate===!0&&(Bs.upload(P,F(Ce),_n,b),I.uniformsNeedUpdate=!1),I.isSpriteMaterial&&ht.setValue(P,"center",C.center),ht.setValue(P,"modelViewMatrix",C.modelViewMatrix),ht.setValue(P,"normalMatrix",C.normalMatrix),ht.setValue(P,"modelMatrix",C.matrixWorld),I.isShaderMaterial||I.isRawShaderMaterial){const Ft=I.uniformsGroups;for(let dr=0,Lc=Ft.length;dr<Lc;dr++){const fo=Ft[dr];N.update(fo,Vt),N.bind(fo,Vt)}}return Vt}function J(v,R){v.ambientLightColor.needsUpdate=R,v.lightProbe.needsUpdate=R,v.directionalLights.needsUpdate=R,v.directionalLightShadows.needsUpdate=R,v.pointLights.needsUpdate=R,v.pointLightShadows.needsUpdate=R,v.spotLights.needsUpdate=R,v.spotLightShadows.needsUpdate=R,v.rectAreaLights.needsUpdate=R,v.hemisphereLights.needsUpdate=R}function ge(v){return v.isMeshLambertMaterial||v.isMeshToonMaterial||v.isMeshPhongMaterial||v.isMeshStandardMaterial||v.isShadowMaterial||v.isShaderMaterial&&v.lights===!0}this.getActiveCubeFace=function(){return z},this.getActiveMipmapLevel=function(){return D},this.getRenderTarget=function(){return A},this.setRenderTargetTextures=function(v,R,L){Ne.get(v.texture).__webglTexture=R,Ne.get(v.depthTexture).__webglTexture=L;const I=Ne.get(v);I.__hasExternalTextures=!0,I.__autoAllocateDepthBuffer=L===void 0,I.__autoAllocateDepthBuffer||Ve.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),I.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(v,R){const L=Ne.get(v);L.__webglFramebuffer=R,L.__useDefaultFramebuffer=R===void 0},this.setRenderTarget=function(v,R=0,L=0){A=v,z=R,D=L;let I=!0,C=null,K=!1,$=!1;if(v){const ce=Ne.get(v);if(ce.__useDefaultFramebuffer!==void 0)De.bindFramebuffer(P.FRAMEBUFFER,null),I=!1;else if(ce.__webglFramebuffer===void 0)b.setupRenderTarget(v);else if(ce.__hasExternalTextures)b.rebindTextures(v,Ne.get(v.texture).__webglTexture,Ne.get(v.depthTexture).__webglTexture);else if(v.depthBuffer){const Te=v.depthTexture;if(ce.__boundDepthTexture!==Te){if(Te!==null&&Ne.has(Te)&&(v.width!==Te.image.width||v.height!==Te.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");b.setupDepthRenderbuffer(v)}}const we=v.texture;(we.isData3DTexture||we.isDataArrayTexture||we.isCompressedArrayTexture)&&($=!0);const Re=Ne.get(v).__webglFramebuffer;v.isWebGLCubeRenderTarget?(Array.isArray(Re[R])?C=Re[R][L]:C=Re[R],K=!0):v.samples>0&&b.useMultisampledRTT(v)===!1?C=Ne.get(v).__webglMultisampledFramebuffer:Array.isArray(Re)?C=Re[L]:C=Re,g.copy(v.viewport),y.copy(v.scissor),W=v.scissorTest}else g.copy(Me).multiplyScalar(ne).floor(),y.copy(ye).multiplyScalar(ne).floor(),W=ze;if(De.bindFramebuffer(P.FRAMEBUFFER,C)&&I&&De.drawBuffers(v,C),De.viewport(g),De.scissor(y),De.setScissorTest(W),K){const ce=Ne.get(v.texture);P.framebufferTexture2D(P.FRAMEBUFFER,P.COLOR_ATTACHMENT0,P.TEXTURE_CUBE_MAP_POSITIVE_X+R,ce.__webglTexture,L)}else if($){const ce=Ne.get(v.texture),we=R||0;P.framebufferTextureLayer(P.FRAMEBUFFER,P.COLOR_ATTACHMENT0,ce.__webglTexture,L||0,we)}B=-1},this.readRenderTargetPixels=function(v,R,L,I,C,K,$){if(!(v&&v.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ee=Ne.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&$!==void 0&&(ee=ee[$]),ee){De.bindFramebuffer(P.FRAMEBUFFER,ee);try{const ce=v.texture,we=ce.format,Re=ce.type;if(!je.textureFormatReadable(we)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!je.textureTypeReadable(Re)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}R>=0&&R<=v.width-I&&L>=0&&L<=v.height-C&&P.readPixels(R,L,I,C,Ie.convert(we),Ie.convert(Re),K)}finally{const ce=A!==null?Ne.get(A).__webglFramebuffer:null;De.bindFramebuffer(P.FRAMEBUFFER,ce)}}},this.readRenderTargetPixelsAsync=async function(v,R,L,I,C,K,$){if(!(v&&v.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ee=Ne.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&$!==void 0&&(ee=ee[$]),ee){const ce=v.texture,we=ce.format,Re=ce.type;if(!je.textureFormatReadable(we))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!je.textureTypeReadable(Re))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(R>=0&&R<=v.width-I&&L>=0&&L<=v.height-C){De.bindFramebuffer(P.FRAMEBUFFER,ee);const Te=P.createBuffer();P.bindBuffer(P.PIXEL_PACK_BUFFER,Te),P.bufferData(P.PIXEL_PACK_BUFFER,K.byteLength,P.STREAM_READ),P.readPixels(R,L,I,C,Ie.convert(we),Ie.convert(Re),0);const Ze=A!==null?Ne.get(A).__webglFramebuffer:null;De.bindFramebuffer(P.FRAMEBUFFER,Ze);const rt=P.fenceSync(P.SYNC_GPU_COMMANDS_COMPLETE,0);return P.flush(),await bh(P,rt,4),P.bindBuffer(P.PIXEL_PACK_BUFFER,Te),P.getBufferSubData(P.PIXEL_PACK_BUFFER,0,K),P.deleteBuffer(Te),P.deleteSync(rt),K}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(v,R=null,L=0){v.isTexture!==!0&&(Os("WebGLRenderer: copyFramebufferToTexture function signature has changed."),R=arguments[0]||null,v=arguments[1]);const I=Math.pow(2,-L),C=Math.floor(v.image.width*I),K=Math.floor(v.image.height*I),$=R!==null?R.x:0,ee=R!==null?R.y:0;b.setTexture2D(v,0),P.copyTexSubImage2D(P.TEXTURE_2D,L,0,0,$,ee,C,K),De.unbindTexture()},this.copyTextureToTexture=function(v,R,L=null,I=null,C=0){v.isTexture!==!0&&(Os("WebGLRenderer: copyTextureToTexture function signature has changed."),I=arguments[0]||null,v=arguments[1],R=arguments[2],C=arguments[3]||0,L=null);let K,$,ee,ce,we,Re;L!==null?(K=L.max.x-L.min.x,$=L.max.y-L.min.y,ee=L.min.x,ce=L.min.y):(K=v.image.width,$=v.image.height,ee=0,ce=0),I!==null?(we=I.x,Re=I.y):(we=0,Re=0);const Te=Ie.convert(R.format),Ze=Ie.convert(R.type);b.setTexture2D(R,0),P.pixelStorei(P.UNPACK_FLIP_Y_WEBGL,R.flipY),P.pixelStorei(P.UNPACK_PREMULTIPLY_ALPHA_WEBGL,R.premultiplyAlpha),P.pixelStorei(P.UNPACK_ALIGNMENT,R.unpackAlignment);const rt=P.getParameter(P.UNPACK_ROW_LENGTH),lt=P.getParameter(P.UNPACK_IMAGE_HEIGHT),Pt=P.getParameter(P.UNPACK_SKIP_PIXELS),Je=P.getParameter(P.UNPACK_SKIP_ROWS),Ce=P.getParameter(P.UNPACK_SKIP_IMAGES),xt=v.isCompressedTexture?v.mipmaps[C]:v.image;P.pixelStorei(P.UNPACK_ROW_LENGTH,xt.width),P.pixelStorei(P.UNPACK_IMAGE_HEIGHT,xt.height),P.pixelStorei(P.UNPACK_SKIP_PIXELS,ee),P.pixelStorei(P.UNPACK_SKIP_ROWS,ce),v.isDataTexture?P.texSubImage2D(P.TEXTURE_2D,C,we,Re,K,$,Te,Ze,xt.data):v.isCompressedTexture?P.compressedTexSubImage2D(P.TEXTURE_2D,C,we,Re,xt.width,xt.height,Te,xt.data):P.texSubImage2D(P.TEXTURE_2D,C,we,Re,K,$,Te,Ze,xt),P.pixelStorei(P.UNPACK_ROW_LENGTH,rt),P.pixelStorei(P.UNPACK_IMAGE_HEIGHT,lt),P.pixelStorei(P.UNPACK_SKIP_PIXELS,Pt),P.pixelStorei(P.UNPACK_SKIP_ROWS,Je),P.pixelStorei(P.UNPACK_SKIP_IMAGES,Ce),C===0&&R.generateMipmaps&&P.generateMipmap(P.TEXTURE_2D),De.unbindTexture()},this.copyTextureToTexture3D=function(v,R,L=null,I=null,C=0){v.isTexture!==!0&&(Os("WebGLRenderer: copyTextureToTexture3D function signature has changed."),L=arguments[0]||null,I=arguments[1]||null,v=arguments[2],R=arguments[3],C=arguments[4]||0);let K,$,ee,ce,we,Re,Te,Ze,rt;const lt=v.isCompressedTexture?v.mipmaps[C]:v.image;L!==null?(K=L.max.x-L.min.x,$=L.max.y-L.min.y,ee=L.max.z-L.min.z,ce=L.min.x,we=L.min.y,Re=L.min.z):(K=lt.width,$=lt.height,ee=lt.depth,ce=0,we=0,Re=0),I!==null?(Te=I.x,Ze=I.y,rt=I.z):(Te=0,Ze=0,rt=0);const Pt=Ie.convert(R.format),Je=Ie.convert(R.type);let Ce;if(R.isData3DTexture)b.setTexture3D(R,0),Ce=P.TEXTURE_3D;else if(R.isDataArrayTexture||R.isCompressedArrayTexture)b.setTexture2DArray(R,0),Ce=P.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}P.pixelStorei(P.UNPACK_FLIP_Y_WEBGL,R.flipY),P.pixelStorei(P.UNPACK_PREMULTIPLY_ALPHA_WEBGL,R.premultiplyAlpha),P.pixelStorei(P.UNPACK_ALIGNMENT,R.unpackAlignment);const xt=P.getParameter(P.UNPACK_ROW_LENGTH),Qe=P.getParameter(P.UNPACK_IMAGE_HEIGHT),Vt=P.getParameter(P.UNPACK_SKIP_PIXELS),Qn=P.getParameter(P.UNPACK_SKIP_ROWS),Lt=P.getParameter(P.UNPACK_SKIP_IMAGES);P.pixelStorei(P.UNPACK_ROW_LENGTH,lt.width),P.pixelStorei(P.UNPACK_IMAGE_HEIGHT,lt.height),P.pixelStorei(P.UNPACK_SKIP_PIXELS,ce),P.pixelStorei(P.UNPACK_SKIP_ROWS,we),P.pixelStorei(P.UNPACK_SKIP_IMAGES,Re),v.isDataTexture||v.isData3DTexture?P.texSubImage3D(Ce,C,Te,Ze,rt,K,$,ee,Pt,Je,lt.data):R.isCompressedArrayTexture?P.compressedTexSubImage3D(Ce,C,Te,Ze,rt,K,$,ee,Pt,lt.data):P.texSubImage3D(Ce,C,Te,Ze,rt,K,$,ee,Pt,Je,lt),P.pixelStorei(P.UNPACK_ROW_LENGTH,xt),P.pixelStorei(P.UNPACK_IMAGE_HEIGHT,Qe),P.pixelStorei(P.UNPACK_SKIP_PIXELS,Vt),P.pixelStorei(P.UNPACK_SKIP_ROWS,Qn),P.pixelStorei(P.UNPACK_SKIP_IMAGES,Lt),C===0&&R.generateMipmaps&&P.generateMipmap(Ce),De.unbindTexture()},this.initRenderTarget=function(v){Ne.get(v).__webglFramebuffer===void 0&&b.setupRenderTarget(v)},this.initTexture=function(v){v.isCubeTexture?b.setTextureCube(v,0):v.isData3DTexture?b.setTexture3D(v,0):v.isDataArrayTexture||v.isCompressedArrayTexture?b.setTexture2DArray(v,0):b.setTexture2D(v,0),De.unbindTexture()},this.resetState=function(){z=0,D=0,A=null,De.reset(),nt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return dn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorSpace=e===$a?"display-p3":"srgb",t.unpackColorSpace=et.workingColorSpace===er?"display-p3":"srgb"}}class to{constructor(e,t=25e-5){this.isFogExp2=!0,this.name="",this.color=new Ye(e),this.density=t}clone(){return new to(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class Bm extends gt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new tn,this.environmentIntensity=1,this.environmentRotation=new tn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}class Di extends Zn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ye(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}}const Ys=new O,qs=new O,ll=new st,ki=new nr,Ts=new tr,Vr=new O,cl=new O;class rr extends gt{constructor(e=new Ut,t=new Di){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)Ys.fromBufferAttribute(t,s-1),qs.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=Ys.distanceTo(qs);e.setAttribute("lineDistance",new Ct(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){const n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ts.copy(n.boundingSphere),Ts.applyMatrix4(s),Ts.radius+=r,e.ray.intersectsSphere(Ts)===!1)return;ll.copy(s).invert(),ki.copy(e.ray).applyMatrix4(ll);const o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=this.isLineSegments?2:1,h=n.index,p=n.attributes.position;if(h!==null){const u=Math.max(0,a.start),_=Math.min(h.count,a.start+a.count);for(let M=u,f=_-1;M<f;M+=c){const d=h.getX(M),E=h.getX(M+1),S=As(this,e,ki,l,d,E);S&&t.push(S)}if(this.isLineLoop){const M=h.getX(_-1),f=h.getX(u),d=As(this,e,ki,l,M,f);d&&t.push(d)}}else{const u=Math.max(0,a.start),_=Math.min(p.count,a.start+a.count);for(let M=u,f=_-1;M<f;M+=c){const d=As(this,e,ki,l,M,M+1);d&&t.push(d)}if(this.isLineLoop){const M=As(this,e,ki,l,_-1,u);M&&t.push(M)}}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){const o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}}function As(i,e,t,n,s,r){const a=i.geometry.attributes.position;if(Ys.fromBufferAttribute(a,s),qs.fromBufferAttribute(a,r),t.distanceSqToSegment(Ys,qs,Vr,cl)>n)return;Vr.applyMatrix4(i.matrixWorld);const l=e.ray.origin.distanceTo(Vr);if(!(l<e.near||l>e.far))return{distance:l,point:cl.clone().applyMatrix4(i.matrixWorld),index:s,face:null,faceIndex:null,barycoord:null,object:i}}const hl=new O,ul=new O;class zm extends rr{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)hl.fromBufferAttribute(t,s),ul.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+hl.distanceTo(ul);e.setAttribute("lineDistance",new Ct(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class ar extends Ut{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};const r=[],a=[];o(s),c(n),h(),this.setAttribute("position",new Ct(r,3)),this.setAttribute("normal",new Ct(r.slice(),3)),this.setAttribute("uv",new Ct(a,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function o(E){const S=new O,T=new O,z=new O;for(let D=0;D<t.length;D+=3)u(t[D+0],S),u(t[D+1],T),u(t[D+2],z),l(S,T,z,E)}function l(E,S,T,z){const D=z+1,A=[];for(let B=0;B<=D;B++){A[B]=[];const ie=E.clone().lerp(T,B/D),g=S.clone().lerp(T,B/D),y=D-B;for(let W=0;W<=y;W++)W===0&&B===D?A[B][W]=ie:A[B][W]=ie.clone().lerp(g,W/y)}for(let B=0;B<D;B++)for(let ie=0;ie<2*(D-B)-1;ie++){const g=Math.floor(ie/2);ie%2===0?(p(A[B][g+1]),p(A[B+1][g]),p(A[B][g])):(p(A[B][g+1]),p(A[B+1][g+1]),p(A[B+1][g]))}}function c(E){const S=new O;for(let T=0;T<r.length;T+=3)S.x=r[T+0],S.y=r[T+1],S.z=r[T+2],S.normalize().multiplyScalar(E),r[T+0]=S.x,r[T+1]=S.y,r[T+2]=S.z}function h(){const E=new O;for(let S=0;S<r.length;S+=3){E.x=r[S+0],E.y=r[S+1],E.z=r[S+2];const T=f(E)/2/Math.PI+.5,z=d(E)/Math.PI+.5;a.push(T,1-z)}_(),m()}function m(){for(let E=0;E<a.length;E+=6){const S=a[E+0],T=a[E+2],z=a[E+4],D=Math.max(S,T,z),A=Math.min(S,T,z);D>.9&&A<.1&&(S<.2&&(a[E+0]+=1),T<.2&&(a[E+2]+=1),z<.2&&(a[E+4]+=1))}}function p(E){r.push(E.x,E.y,E.z)}function u(E,S){const T=E*3;S.x=e[T+0],S.y=e[T+1],S.z=e[T+2]}function _(){const E=new O,S=new O,T=new O,z=new O,D=new Ue,A=new Ue,B=new Ue;for(let ie=0,g=0;ie<r.length;ie+=9,g+=6){E.set(r[ie+0],r[ie+1],r[ie+2]),S.set(r[ie+3],r[ie+4],r[ie+5]),T.set(r[ie+6],r[ie+7],r[ie+8]),D.set(a[g+0],a[g+1]),A.set(a[g+2],a[g+3]),B.set(a[g+4],a[g+5]),z.copy(E).add(S).add(T).divideScalar(3);const y=f(z);M(D,g+0,E,y),M(A,g+2,S,y),M(B,g+4,T,y)}}function M(E,S,T,z){z<0&&E.x===1&&(a[S]=E.x-1),T.x===0&&T.z===0&&(a[S]=z/2/Math.PI+.5)}function f(E){return Math.atan2(E.z,-E.x)}function d(E){return Math.atan2(-E.y,Math.sqrt(E.x*E.x+E.z*E.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ar(e.vertices,e.indices,e.radius,e.details)}}class no extends ar{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new no(e.radius,e.detail)}}class or extends ar{constructor(e=1,t=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],s=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,s,e,t),this.type="OctahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new or(e.radius,e.detail)}}class pc extends Zn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new Ye(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ye(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=$l,this.normalScale=new Ue(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new tn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class km extends Di{constructor(e){super(),this.isLineDashedMaterial=!0,this.type="LineDashedMaterial",this.scale=1,this.dashSize=3,this.gapSize=1,this.setValues(e)}copy(e){return super.copy(e),this.scale=e.scale,this.dashSize=e.dashSize,this.gapSize=e.gapSize,this}}class mc extends gt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Ye(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}}const Wr=new st,dl=new O,fl=new O;class Hm{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ue(512,512),this.map=null,this.mapPass=null,this.matrix=new st,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Qa,this._frameExtents=new Ue(1,1),this._viewportCount=1,this._viewports=[new ct(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;dl.setFromMatrixPosition(e.matrixWorld),t.position.copy(dl),fl.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(fl),t.updateMatrixWorld(),Wr.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Wr),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Wr)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class Gm extends Hm{constructor(){super(new lc(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class _c extends mc{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(gt.DEFAULT_UP),this.updateMatrix(),this.target=new gt,this.shadow=new Gm}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class Vm extends mc{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}}const pl=new st;class Wm{constructor(e,t,n=0,s=1/0){this.ray=new nr(e,t),this.near=n,this.far=s,this.camera=null,this.layers=new Za,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return pl.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(pl),this}intersectObject(e,t=!0,n=[]){return ka(e,this,n,t),n.sort(ml),n}intersectObjects(e,t=!0,n=[]){for(let s=0,r=e.length;s<r;s++)ka(e[s],this,n,t);return n.sort(ml),n}}function ml(i,e){return i.distance-e.distance}function ka(i,e,t,n){let s=!0;if(i.layers.test(e.layers)&&i.raycast(e,t)===!1&&(s=!1),s===!0&&n===!0){const r=i.children;for(let a=0,o=r.length;a<o;a++)ka(r[a],e,t,!0)}}class _l{constructor(e=1,t=0,n=0){return this.radius=e,this.phi=t,this.theta=n,this}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(bt(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}class Xm extends zm{constructor(e=10,t=10,n=4473924,s=8947848){n=new Ye(n),s=new Ye(s);const r=t/2,a=e/t,o=e/2,l=[],c=[];for(let p=0,u=0,_=-o;p<=t;p++,_+=a){l.push(-o,0,_,o,0,_),l.push(_,0,-o,_,0,o);const M=p===r?n:s;M.toArray(c,u),u+=3,M.toArray(c,u),u+=3,M.toArray(c,u),u+=3,M.toArray(c,u),u+=3}const h=new Ut;h.setAttribute("position",new Ct(l,3)),h.setAttribute("color",new Ct(c,3));const m=new Di({vertexColors:!0,toneMapped:!1});super(h,m),this.type="GridHelper"}dispose(){this.geometry.dispose(),this.material.dispose()}}class Ym extends $n{constructor(e,t=null){super(),this.object=e,this.domElement=t,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(){}disconnect(){}dispose(){}update(){}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Va}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Va);const gl={type:"change"},io={type:"start"},gc={type:"end"},ws=new nr,vl=new En,qm=Math.cos(70*yh.DEG2RAD),ft=new O,At=2*Math.PI,it={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},Xr=1e-6;class jm extends Ym{constructor(e,t=null){super(e,t),this.state=it.NONE,this.enabled=!0,this.target=new O,this.cursor=new O,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:vi.ROTATE,MIDDLE:vi.DOLLY,RIGHT:vi.PAN},this.touches={ONE:_i.ROTATE,TWO:_i.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this._lastPosition=new O,this._lastQuaternion=new jn,this._lastTargetPosition=new O,this._quat=new jn().setFromUnitVectors(e.up,new O(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new _l,this._sphericalDelta=new _l,this._scale=1,this._panOffset=new O,this._rotateStart=new Ue,this._rotateEnd=new Ue,this._rotateDelta=new Ue,this._panStart=new Ue,this._panEnd=new Ue,this._panDelta=new Ue,this._dollyStart=new Ue,this._dollyEnd=new Ue,this._dollyDelta=new Ue,this._dollyDirection=new O,this._mouse=new Ue,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=$m.bind(this),this._onPointerDown=Km.bind(this),this._onPointerUp=Zm.bind(this),this._onContextMenu=s_.bind(this),this._onMouseWheel=e_.bind(this),this._onKeyDown=t_.bind(this),this._onTouchStart=n_.bind(this),this._onTouchMove=i_.bind(this),this._onMouseDown=Jm.bind(this),this._onMouseMove=Qm.bind(this),this._interceptControlDown=r_.bind(this),this._interceptControlUp=a_.bind(this),this.domElement!==null&&this.connect(),this.update()}connect(){this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(gl),this.update(),this.state=it.NONE}update(e=null){const t=this.object.position;ft.copy(t).sub(this.target),ft.applyQuaternion(this._quat),this._spherical.setFromVector3(ft),this.autoRotate&&this.state===it.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let n=this.minAzimuthAngle,s=this.maxAzimuthAngle;isFinite(n)&&isFinite(s)&&(n<-Math.PI?n+=At:n>Math.PI&&(n-=At),s<-Math.PI?s+=At:s>Math.PI&&(s-=At),n<=s?this._spherical.theta=Math.max(n,Math.min(s,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(n+s)/2?Math.max(n,this._spherical.theta):Math.min(s,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let r=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const a=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),r=a!=this._spherical.radius}if(ft.setFromSpherical(this._spherical),ft.applyQuaternion(this._quatInverse),t.copy(this.target).add(ft),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let a=null;if(this.object.isPerspectiveCamera){const o=ft.length();a=this._clampDistance(o*this._scale);const l=o-a;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),r=!!l}else if(this.object.isOrthographicCamera){const o=new O(this._mouse.x,this._mouse.y,0);o.unproject(this.object);const l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),r=l!==this.object.zoom;const c=new O(this._mouse.x,this._mouse.y,0);c.unproject(this.object),this.object.position.sub(c).add(o),this.object.updateMatrixWorld(),a=ft.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;a!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(a).add(this.object.position):(ws.origin.copy(this.object.position),ws.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(ws.direction))<qm?this.object.lookAt(this.target):(vl.setFromNormalAndCoplanarPoint(this.object.up,this.target),ws.intersectPlane(vl,this.target))))}else if(this.object.isOrthographicCamera){const a=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),a!==this.object.zoom&&(this.object.updateProjectionMatrix(),r=!0)}return this._scale=1,this._performCursorZoom=!1,r||this._lastPosition.distanceToSquared(this.object.position)>Xr||8*(1-this._lastQuaternion.dot(this.object.quaternion))>Xr||this._lastTargetPosition.distanceToSquared(this.target)>Xr?(this.dispatchEvent(gl),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e!==null?At/60*this.autoRotateSpeed*e:At/60/60*this.autoRotateSpeed}_getZoomScale(e){const t=Math.abs(e*.01);return Math.pow(.95,this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){ft.setFromMatrixColumn(t,0),ft.multiplyScalar(-e),this._panOffset.add(ft)}_panUp(e,t){this.screenSpacePanning===!0?ft.setFromMatrixColumn(t,1):(ft.setFromMatrixColumn(t,0),ft.crossVectors(this.object.up,ft)),ft.multiplyScalar(e),this._panOffset.add(ft)}_pan(e,t){const n=this.domElement;if(this.object.isPerspectiveCamera){const s=this.object.position;ft.copy(s).sub(this.target);let r=ft.length();r*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*r/n.clientHeight,this.object.matrix),this._panUp(2*t*r/n.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/n.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/n.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const n=this.domElement.getBoundingClientRect(),s=e-n.left,r=t-n.top,a=n.width,o=n.height;this._mouse.x=s/a*2-1,this._mouse.y=-(r/o)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(At*this._rotateDelta.x/t.clientHeight),this._rotateUp(At*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(At*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(-At*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(At*this.rotateSpeed/this.domElement.clientHeight):this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(-At*this.rotateSpeed/this.domElement.clientHeight):this._pan(-this.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._rotateStart.set(n,s)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._panStart.set(n,s)}}_handleTouchStartDolly(e){const t=this._getSecondPointerPosition(e),n=e.pageX-t.x,s=e.pageY-t.y,r=Math.sqrt(n*n+s*s);this._dollyStart.set(0,r)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{const n=this._getSecondPointerPosition(e),s=.5*(e.pageX+n.x),r=.5*(e.pageY+n.y);this._rotateEnd.set(s,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(At*this._rotateDelta.x/t.clientHeight),this._rotateUp(At*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._panEnd.set(n,s)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){const t=this._getSecondPointerPosition(e),n=e.pageX-t.x,s=e.pageY-t.y,r=Math.sqrt(n*n+s*s);this._dollyEnd.set(0,r),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const a=(e.pageX+t.x)*.5,o=(e.pageY+t.y)*.5;this._updateZoomParameters(a,o)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new Ue,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){const t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){const t=e.deltaMode,n={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:n.deltaY*=16;break;case 2:n.deltaY*=100;break}return e.ctrlKey&&!this._controlActive&&(n.deltaY*=10),n}}function Km(i){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(i.pointerId),this.domElement.addEventListener("pointermove",this._onPointerMove),this.domElement.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(i)&&(this._addPointer(i),i.pointerType==="touch"?this._onTouchStart(i):this._onMouseDown(i)))}function $m(i){this.enabled!==!1&&(i.pointerType==="touch"?this._onTouchMove(i):this._onMouseMove(i))}function Zm(i){switch(this._removePointer(i),this._pointers.length){case 0:this.domElement.releasePointerCapture(i.pointerId),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(gc),this.state=it.NONE;break;case 1:const e=this._pointers[0],t=this._pointerPositions[e];this._onTouchStart({pointerId:e,pageX:t.x,pageY:t.y});break}}function Jm(i){let e;switch(i.button){case 0:e=this.mouseButtons.LEFT;break;case 1:e=this.mouseButtons.MIDDLE;break;case 2:e=this.mouseButtons.RIGHT;break;default:e=-1}switch(e){case vi.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(i),this.state=it.DOLLY;break;case vi.ROTATE:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=it.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=it.ROTATE}break;case vi.PAN:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=it.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=it.PAN}break;default:this.state=it.NONE}this.state!==it.NONE&&this.dispatchEvent(io)}function Qm(i){switch(this.state){case it.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(i);break;case it.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(i);break;case it.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(i);break}}function e_(i){this.enabled===!1||this.enableZoom===!1||this.state!==it.NONE||(i.preventDefault(),this.dispatchEvent(io),this._handleMouseWheel(this._customWheelEvent(i)),this.dispatchEvent(gc))}function t_(i){this.enabled===!1||this.enablePan===!1||this._handleKeyDown(i)}function n_(i){switch(this._trackPointer(i),this._pointers.length){case 1:switch(this.touches.ONE){case _i.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(i),this.state=it.TOUCH_ROTATE;break;case _i.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(i),this.state=it.TOUCH_PAN;break;default:this.state=it.NONE}break;case 2:switch(this.touches.TWO){case _i.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(i),this.state=it.TOUCH_DOLLY_PAN;break;case _i.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(i),this.state=it.TOUCH_DOLLY_ROTATE;break;default:this.state=it.NONE}break;default:this.state=it.NONE}this.state!==it.NONE&&this.dispatchEvent(io)}function i_(i){switch(this._trackPointer(i),this.state){case it.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(i),this.update();break;case it.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(i),this.update();break;case it.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(i),this.update();break;case it.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(i),this.update();break;default:this.state=it.NONE}}function s_(i){this.enabled!==!1&&i.preventDefault()}function r_(i){i.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function a_(i){i.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}class o_ extends gt{constructor(e=document.createElement("div")){super(),this.isCSS2DObject=!0,this.element=e,this.element.style.position="absolute",this.element.style.userSelect="none",this.element.setAttribute("draggable",!1),this.center=new Ue(.5,.5),this.addEventListener("removed",function(){this.traverse(function(t){t.element instanceof Element&&t.element.parentNode!==null&&t.element.parentNode.removeChild(t.element)})})}copy(e,t){return super.copy(e,t),this.element=e.element.cloneNode(!0),this.center=e.center,this}}const mi=new O,xl=new st,Ml=new st,Sl=new O,yl=new O;class l_{constructor(e={}){const t=this;let n,s,r,a;const o={objects:new WeakMap},l=e.element!==void 0?e.element:document.createElement("div");l.style.overflow="hidden",this.domElement=l,this.getSize=function(){return{width:n,height:s}},this.render=function(_,M){_.matrixWorldAutoUpdate===!0&&_.updateMatrixWorld(),M.parent===null&&M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),xl.copy(M.matrixWorldInverse),Ml.multiplyMatrices(M.projectionMatrix,xl),h(_,_,M),u(_)},this.setSize=function(_,M){n=_,s=M,r=n/2,a=s/2,l.style.width=_+"px",l.style.height=M+"px"};function c(_){_.isCSS2DObject&&(_.element.style.display="none");for(let M=0,f=_.children.length;M<f;M++)c(_.children[M])}function h(_,M,f){if(_.visible===!1){c(_);return}if(_.isCSS2DObject){mi.setFromMatrixPosition(_.matrixWorld),mi.applyMatrix4(Ml);const d=mi.z>=-1&&mi.z<=1&&_.layers.test(f.layers)===!0,E=_.element;E.style.display=d===!0?"":"none",d===!0&&(_.onBeforeRender(t,M,f),E.style.transform="translate("+-100*_.center.x+"%,"+-100*_.center.y+"%)translate("+(mi.x*r+r)+"px,"+(-mi.y*a+a)+"px)",E.parentNode!==l&&l.appendChild(E),_.onAfterRender(t,M,f));const S={distanceToCameraSquared:m(f,_)};o.objects.set(_,S)}for(let d=0,E=_.children.length;d<E;d++)h(_.children[d],M,f)}function m(_,M){return Sl.setFromMatrixPosition(_.matrixWorld),yl.setFromMatrixPosition(M.matrixWorld),Sl.distanceToSquared(yl)}function p(_){const M=[];return _.traverseVisible(function(f){f.isCSS2DObject&&M.push(f)}),M}function u(_){const M=p(_).sort(function(d,E){if(d.renderOrder!==E.renderOrder)return E.renderOrder-d.renderOrder;const S=o.objects.get(d).distanceToCameraSquared,T=o.objects.get(E).distanceToCameraSquared;return S-T}),f=M.length;for(let d=0,E=M.length;d<E;d++)M[d].element.style.zIndex=f-d}}}function Rs(i){let e=0;for(const t of i){const n=t.geometry;n!==void 0&&(n.dispose(),e+=1)}return e}const Yr=6e4;function c_(i,e,t=Date.now){let n=-Yr;return{fault(s){const r=t();r-n>=Yr&&(e(`[nexus] ${s}`),n=r),i.show(s)},clear(){i.hide(),n=-Yr}}}const h_={bg0:"#060a12"},El={nodeLive:4906624,nodeCold:4871528},bl=[9133302,3900150,1357990,16096779,15485081,8702998];function vc(){return typeof window<"u"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches}function u_(i,e,t){const n=i.filter(r=>r.live!==!1).length,s=i.length-n;return"A2A 拓扑："+i.length+" 个节点（"+n+" live / "+s+" cold），"+e.length+" 个团队，"+t.length+" 个联邦对端"}function d_(i,e,t,n){const s=new Di({color:2282478,transparent:!0,opacity:.18});for(const r of i){const a=r.members.filter(c=>e.has(c.id));if(a.length<2)continue;const o=new O;for(const c of a)o.add(e.get(c.id).position);o.divideScalar(a.length);const l=new kt(new or(.35,0),new Ja({color:2282478,transparent:!0,opacity:.5}));l.position.copy(o),l.userData={team:r.name},n.add(l);for(const c of a){const h=new Ut().setFromPoints([o,e.get(c.id).position.clone()]);t.add(new rr(h,s.clone()))}}}function f_(i,e,t){i.forEach((n,s)=>{const r=n.url.replace(/^\w+:\/\//,""),a=new kt(new or(1.3,0),new pc({color:6514417,emissive:6514417,emissiveIntensity:.5,transparent:!0,opacity:.75}));a.position.set(-20-s*10,14+s%2*6,-12-s*6),a.userData={label:"Peer: "+r,kind:"peer",peer:r},e.add(a);const o=new Ut().setFromPoints([new O(0,-4,0),a.position.clone()]),l=new km({color:6514417,dashSize:1.2,gapSize:.8,transparent:!0,opacity:.35}),c=new rr(o,l);c.computeLineDistances(),t.add(c)})}const Tl=18;function p_(i){const e=i.includes("/")?i.slice(i.lastIndexOf("/")+1):i;return e.length<=Tl?e:e.slice(0,Tl)+"…"}function m_(i,e,t,n){const s=document.createElement("div");s.className="nexus-label "+(t?"live":"cold");const r=document.createElement("span");r.className="nm",r.textContent=p_(e);const a=document.createElement("span");a.className="sub",a.textContent=(t?"live":"cold")+" · "+n,s.append(r,a);const o=new o_(s);return o.position.set(0,1.6,0),i.add(o),o}function __(i){i.removeFromParent()}let bn=null;function xc(i,e){bn||(bn=document.createElement("div"),bn.className="nexus-inspector",i.appendChild(bn)),bn.textContent=e,bn.style.display="block"}function so(){bn&&(bn.style.display="none")}function g_(i,e){i.setAttribute("aria-label",e)}function v_(i,e,t,n){g_(i,u_(e,t,n))}function x_(i,e){return t=>{if(t.key==="Escape"){i.escape(),e.focus();return}if(t.key==="Enter"||t.key==="Tab"){t.preventDefault();const n=i.nextAfter(i.pinned());n!==void 0&&i.pin(n)}}}function M_(i,e){let t=0;return i.addEventListener("change",()=>{e()}),{isTicking:()=>!1,renderOnceCount:()=>t,renderOnce:()=>{t+=1,e()}}}const wn=1e6,ro=.25,ao=3,Mc=256,Sc=96;function Pi(i){const e=typeof i=="number"?i:Number.NaN;if(Number.isFinite(e))return Math.max(-wn,Math.min(wn,Math.round(e)))}function yc(i){if(i===null||typeof i!="object")return;const e=i,t=Pi(e.x),n=Pi(e.y);return t===void 0||n===void 0?void 0:{x:t,y:n}}function S_(i){const e=yc(i);if(e===void 0)return;const t=i,n=Pi(t.w),s=Pi(t.h);if(!(n===void 0||s===void 0||n<=0||s<=0))return{...e,w:Math.min(n,wn),h:Math.min(s,wn)}}function Ec(i){if(i===null||typeof i!="object")return;const e=i;if(e.version!==1)return;const t=e.viewport;if(t===null||typeof t!="object")return;const n=t,s=Pi(n.x),r=Pi(n.y),a=n.scale,o=typeof a=="number"?a:Number.NaN;if(s===void 0||r===void 0||!Number.isFinite(o))return;const l=Math.max(ro,Math.min(ao,o)),c={};if(e.nodes!==null&&typeof e.nodes=="object")for(const[m,p]of Object.entries(e.nodes)){if(typeof m!="string"||m===""||m.length>128)continue;const u=yc(p);if(u!==void 0&&(c[m]=u),Object.keys(c).length>=Mc)break}const h={};if(e.frames!==null&&typeof e.frames=="object")for(const[m,p]of Object.entries(e.frames)){if(typeof m!="string"||m===""||m.includes("/")||m.length>40)continue;const u=S_(p);if(u!==void 0&&(h[m]=u),Object.keys(h).length>=Sc)break}return{version:1,viewport:{x:s,y:r,scale:l},nodes:c,frames:h}}function y_(i,e,t){const n=a=>Math.max(-wn,Math.min(wn,Math.round(a))),s={};for(const[a,o]of e)if(!(typeof a!="string"||a===""||a.length>128)&&(s[a]={x:n(o.x),y:n(o.y)},Object.keys(s).length>=Mc))break;const r={};for(const[a,o]of t){if(typeof a!="string"||a===""||a.includes("/")||a.length>40)continue;const l=n(o.w),c=n(o.h);if(!(l<=0||c<=0)&&(r[a]={x:n(o.x),y:n(o.y),w:Math.min(l,wn),h:Math.min(c,wn)},Object.keys(r).length>=Sc))break}return{version:1,viewport:{x:n(i.x),y:n(i.y),scale:Math.max(ro,Math.min(ao,i.scale))},nodes:s,frames:r}}const Al=12,E_=30,wl=1;function bc(i){let e=2166136261;for(let t=0;t<i.length;t++)e^=i.charCodeAt(t),e=Math.imul(e,16777619)>>>0;return e>>>0}function b_(i){const e=bc(i),t=e%3600/3600*Math.PI*2,n=Al+(e>>>9)%1800/1800*(E_-Al),s=(e>>>18)%2e3/1999*2*wl-wl;return{x:Math.cos(t)*n,y:s,z:Math.sin(t)*n}}const Rl=172,Ha=56,Cl=[150,290,430],Cs=16;function Tc(i){const e=bc(i),t=Math.floor(e/Cs)%Cl.length,s=e%Cs/Cs*Math.PI*2+t*(Math.PI/Cs),r=Cl[t];return{x:Math.round(Math.cos(s)*r),y:Math.round(Math.sin(s)*r*.6)}}function yi(i){return{x:i.x-Rl/2,y:i.y-Ha/2,w:Rl,h:Ha}}function oo(i){if(i.length===0)return{x:0,y:0,w:260,h:160};let e=Number.POSITIVE_INFINITY,t=Number.POSITIVE_INFINITY,n=Number.NEGATIVE_INFINITY,s=Number.NEGATIVE_INFINITY;for(const h of i)e=Math.min(e,h.x),t=Math.min(t,h.y),n=Math.max(n,h.x+h.w),s=Math.max(s,h.y+h.h);const r=24,a=44,o=24,l=Math.max(260,Math.round(n-e+r*2)),c=Math.max(160,Math.round(s-t+a+o));return{x:Math.round(e-r),y:Math.round(t-a),w:l,h:c}}class lo{constructor(){ei(this,"revisionCounter",0);ei(this,"nodes",new Map);ei(this,"frames",new Map);ei(this,"selection",new Set);ei(this,"viewport",{x:0,y:0,scale:1})}get revision(){return this.revisionCounter}getNode(e){return this.nodes.get(e)}allNodes(){return[...this.nodes.values()]}nodeIds(){return[...this.nodes.keys()]}getFrame(e){return this.frames.get(e)}allFrames(){return[...this.frames.entries()]}isSelected(e){return this.selection.has(e)}selectedIds(){return[...this.selection]}bump(){this.revisionCounter+=1}dragNodes(e,t,n){let s=!1;for(const r of e){const a=this.nodes.get(r);a!==void 0&&(a.x+=t,a.y+=n,s=!0)}s&&this.bump()}beginFrameDrag(e){const t=this.frames.get(e);if(t===void 0)return;const n=[];for(const s of this.nodes.values())for(const r of s.memberships)if(r.team===e){n.push([s.id,s.x,s.y]);break}return{name:e,rect:{...t},centers:n}}applyFrameDrag(e,t,n){const s=this.frames.get(e.name);if(s!==void 0){s.x=e.rect.x+t,s.y=e.rect.y+n;for(const[r,a,o]of e.centers){const l=this.nodes.get(r);l!==void 0&&(l.x=a+t,l.y=o+n)}this.bump()}}nudge(e,t,n){this.dragNodes(e,t,n)}marqueeSelect(e,t){t||this.selection.clear();for(const n of this.nodes.values()){const s=yi(n);s.x<e.x+e.w&&s.x+s.w>e.x&&s.y<e.y+e.h&&s.y+s.h>e.y&&this.selection.add(n.id)}this.bump()}setSelection(e){this.selection=new Set(e),this.bump()}upsertNode(e){const t=this.nodes.get(e.id);if(t===void 0){this.nodes.set(e.id,e),this.bump();return}t.label=e.label,t.name=e.name,t.live=e.live,t.memberships=e.memberships,this.bump()}removeNode(e){this.nodes.delete(e)&&(this.selection.delete(e),this.bump())}setFrame(e,t){this.frames.set(e,t),this.bump()}removeFrame(e){this.frames.delete(e)&&this.bump()}upsertScore(e,t){const n=this.nodes.get(e);n===void 0||n.score===t||(n.score=t,this.bump())}positions(){const e=new Map;for(const[t,n]of this.nodes)e.set(t,{x:n.x,y:n.y});return e}frameRects(){const e=new Map;for(const[t,n]of this.frames)e.set(t,{...n});return e}teamMemberIds(e){const t=[];for(const n of this.nodes.values()){const s=n.memberships.find(r=>r.team===e);s!==void 0&&t.push({id:n.id,index:s.index})}return t.sort((n,s)=>n.index-s.index).map(n=>n.id)}setTeamMembers(e,t){for(const n of this.nodes.values()){const s=n.memberships.filter(a=>a.team!==e),r=t.indexOf(n.id);r>=0&&s.push({team:e,index:r}),n.memberships=s}this.bump()}contentBounds(){let e=Number.POSITIVE_INFINITY,t=Number.POSITIVE_INFINITY,n=Number.NEGATIVE_INFINITY,s=Number.NEGATIVE_INFINITY;const r=a=>{e=Math.min(e,a.x),t=Math.min(t,a.y),n=Math.max(n,a.x+a.w),s=Math.max(s,a.y+a.h)};for(const a of this.nodes.values())a.remote!==!0&&r(yi(a));for(const a of this.frames.values())r(a);return e===Number.POSITIVE_INFINITY?null:{minX:e,minY:t,maxX:n,maxY:s}}static fromState(e){const t=new lo,n=Ec(e.layout),s=new Map;for(const r of e.teams)for(let a=0;a<r.members.length;a++){const o=r.members[a].id,l=s.get(o)??[];l.push({team:r.name,index:a}),s.set(o,l)}for(const r of e.sessions){if(r.joined!==!0)continue;const a=n==null?void 0:n.nodes[r.id];let o,l;if(a!==void 0&&typeof a.x=="number"&&typeof a.y=="number")o=a.x,l=a.y;else{const c=Tc(r.id);o=c.x,l=c.y}t.nodes.set(r.id,{id:r.id,x:o,y:l,label:r.label,team:r.team,name:r.name,live:r.live!==!1,memberships:s.get(r.id)??[]})}for(const r of e.teams){const a=n==null?void 0:n.frames[r.name];if(a!==void 0){t.frames.set(r.name,{x:a.x,y:a.y,w:a.w,h:a.h});continue}const o=[];for(const l of r.members){const c=t.nodes.get(l.id);c!==void 0&&o.push(yi(c))}o.length>0&&t.frames.set(r.name,oo(o))}return t.viewport=n!==void 0?{...n.viewport}:{x:0,y:0,scale:1},t}}const T_=24,A_=-13,Ac=A_+T_;function w_(i,e,t){const n=[],s=new Set;for(const r of i){const a=e.get(r.name);if(a===void 0)continue;const o=a.x+a.w/2,l=a.y+Ac;for(const c of r.members){const h=t.get(c.id);if(h===void 0)continue;const m=s.has(c.id);s.add(c.id),n.push({x1:o,y1:l,x2:h.x,y2:h.y-Ha/2,dashed:m,team:r.name,id:c.id})}}return n}function R_(i){return`peer-${co(i).replace(/[^A-Za-z0-9.:\[\]-]/g,"-")}`}function co(i){try{return new URL(i).host}catch{return i}}function C_(i){const e=new Map;for(const t of i){const n=t.via!==void 0&&t.via!==""?co(t.via):"",s=e.get(n)??[];s.push(t),e.set(n,s)}return e}const P_=140,L_=200,D_=90,I_=20,Ps=60;function N_(i,e){const t=e!==null?e.maxX+P_:L_,n=e!==null?e.minY:0;return i.map((s,r)=>({url:s.url,score:s.score,x:t,y:n+r*D_}))}function U_(i,e,t,n){const s=new Map;for(const a of i){if(!e.has(a.team))continue;const o=`${a.team}\0${a.peer}`,l=s.get(o);l===void 0?s.set(o,{team:a.team,peer:a.peer,startedAt:a.startedAt,count:1}):(l.startedAt=Math.min(l.startedAt,a.startedAt),l.count+=1)}const r=[];for(const a of s.values()){const o=e.get(a.team);if(o===void 0)continue;const l=t.find(h=>{try{return new URL(h.url).host===a.peer}catch{return!1}});if(l===void 0)continue;const c=Math.max(0,Math.round((n-a.startedAt)/1e3));r.push({x1:o.x,y1:o.y,x2:l.x,y2:l.y,label:`a2a_route · ${a.peer} · ${c}s`+(a.count>1?` ×${a.count}`:"")})}return r}function F_(i,e){const t=e!==null?{x:e.maxX+I_,y:i.length>0?(i[0].y+i[i.length-1].y)/2:(e.minY+e.maxY)/2}:{x:-80,y:0};return i.map((n,s)=>({x1:t.x,y1:t.y,x2:n.x,y2:n.y,label:s===0?"gns referral":""}))}function O_(i,e){if(i===null&&e.length===0)return null;let t=i!==null?i.minX:Number.POSITIVE_INFINITY,n=i!==null?i.minY:Number.POSITIVE_INFINITY,s=i!==null?i.maxX:Number.NEGATIVE_INFINITY,r=i!==null?i.maxY:Number.NEGATIVE_INFINITY;for(const a of e)t=Math.min(t,a.x-Ps),n=Math.min(n,a.y-Ps),s=Math.max(s,a.x+Ps),r=Math.max(r,a.y+Ps);return{minX:t,minY:n,maxX:s,maxY:r}}const Pl={x:0,y:0,scale:1};function ho(i){return Math.max(ro,Math.min(ao,i))}function qr(i){const e=Number.isFinite(i.scale)?i.scale:1,t=Number.isFinite(i.x)?i.x:0,n=Number.isFinite(i.y)?i.y:0;return{x:t,y:n,scale:ho(e)}}function kn(i,e,t){return{x:i.x+e/i.scale,y:i.y+t/i.scale}}function jr(i,e,t){return{x:i.x+e/i.scale,y:i.y+t/i.scale,scale:i.scale}}function Ll(i,e,t,n){const s=ho(i.scale*e);return s===i.scale?i:{x:i.x+t/i.scale-t/s,y:i.y+n/i.scale-n/s,scale:s}}function Dl(i,e,t){if(i===null||e<=0||t<=0)return Pl;const n=i.maxX-i.minX,s=i.maxY-i.minY;if(!(n>0)||!(s>0))return Pl;const r=ho(.9*Math.min(e/n,t/s));return{x:(i.minX+i.maxX)/2-e/(2*r),y:(i.minY+i.maxY)/2-t/(2*r),scale:r}}function B_(i){return`translate(${-i.x*i.scale}px, ${-i.y*i.scale}px) scale(${i.scale})`}function z_(i){return i.type==="create-team"||i.type==="remove-team"?i.name:i.team}function k_(i,e){if(e.type==="create-team"){const s=e.ids.map(r=>i.getNode(r)).filter(r=>r!==void 0).map(r=>yi(r));return i.setFrame(e.name,oo(s)),i.setTeamMembers(e.name,e.ids),()=>{i.setTeamMembers(e.name,i.teamMemberIds(e.name).filter(r=>!e.ids.includes(r))),i.removeFrame(e.name)}}if(e.type==="add-member"){const s=i.teamMemberIds(e.team),r=e.ids.filter(a=>!s.includes(a));return i.setTeamMembers(e.team,[...s,...r]),()=>{i.setTeamMembers(e.team,i.teamMemberIds(e.team).filter(a=>!r.includes(a)))}}if(e.type==="remove-member"){const s=i.teamMemberIds(e.team);return i.setTeamMembers(e.team,s.filter(r=>!e.ids.includes(r))),()=>{const r=i.teamMemberIds(e.team);i.setTeamMembers(e.team,[...r,...e.ids.filter(a=>!r.includes(a))])}}if(e.type==="remove-team"){const s=i.teamMemberIds(e.name),r=i.getFrame(e.name),a=r!==void 0?{...r}:void 0;return i.setTeamMembers(e.name,[]),i.removeFrame(e.name),()=>{a!==void 0&&i.setFrame(e.name,a),i.setTeamMembers(e.name,s)}}const t=i.teamMemberIds(e.team);let n=[...t];for(const s of e.ops)s.op==="remove"?n=n.filter(r=>r!==s.id):n.push(s.id);return i.setTeamMembers(e.team,n),()=>{let s=i.teamMemberIds(e.team);for(let r=0;r<t.length;r++){const a=t[r];s[r]!==a&&s.includes(a)&&(s=s.filter(o=>o!==a),s.push(a))}i.setTeamMembers(e.team,s)}}function Kr(i,e){const t=[...i],n=[];for(let s=0;s<e.length;s++){const r=e[s];t[s]!==r&&t.includes(r)&&(n.push({op:"remove",id:r}),n.push({op:"add",id:r}),t.splice(t.indexOf(r),1),t.push(r))}return n}function H_(i,e){return i.teamMemberIds(e).map(t=>{var n;return{id:t,y:((n=i.getNode(t))==null?void 0:n.y)??0}}).sort((t,n)=>t.y-n.y).map(t=>t.id)}function Il(i,e){let t,n=Number.POSITIVE_INFINITY;for(const[s,r]of i){if(e.x<r.x||e.x>r.x+r.w||e.y<r.y||e.y>r.y+r.h)continue;const a=r.w*r.h;a<n&&(t=s,n=a)}return t}function G_(i){let e=0;for(let o=0;o<i.length;o++)e=(e*31+i.charCodeAt(o)&268435455)>>>0;const t=bl[e%bl.length],n="#"+t.toString(16).padStart(6,"0"),s=t>>16&255,r=t>>8&255,a=t&255;return{line:n,bg:`rgba(${s},${r},${a},0.05)`}}function V_(i){const e=new lo;let t,n={...e.viewport},s={kind:"none"},r=!1,a=-1;const o=i.now??Date.now,l=new AbortController,c=[];let h=null,m=!1;const p={signal:l.signal},u=document.createElement("section");u.id="dsh-plan",u.setAttribute("role","tabpanel"),u.setAttribute("aria-label","A2A 规划画布"),u.tabIndex=0,u.style.display="none";const _=document.createElement("div");_.className="p-grid";const M=document.createElement("div");M.className="p-world";const f=document.createElementNS("http://www.w3.org/2000/svg","svg");f.setAttribute("class","p-edges");const d=document.createElement("div");d.className="p-layer p-frames";const E=document.createElement("div");E.className="p-layer p-nodes",E.setAttribute("role","listbox"),E.setAttribute("aria-multiselectable","true"),E.setAttribute("aria-label","会话节点"),M.append(f,d,E);const S=document.createElement("div");S.className="p-marquee";const T=document.createElement("div");T.className="p-toolbar";const z=document.createElement("span");z.className="p-zoom mono",z.textContent="100%";const D=(w,U,F)=>{const X=document.createElement("button");return X.type="button",X.textContent=w,X.title=U,X.addEventListener("click",F,p),X};T.append(D("适配(0)","适配视图（0）",()=>_e()),D("－","缩小",()=>de(1/1.2)),z,D("＋","放大",()=>de(1.2)),D("建队","组成团队（G）：先框选至少 2 个节点",()=>be()));const A=document.createElement("span");A.setAttribute("aria-live","polite"),A.className="p-lamp";const B=document.createElement("i"),ie=document.createElement("span");ie.textContent="布局",A.append(B,ie),A.addEventListener("click",()=>{A.classList.contains("error")&&i.onLampClick()},p),A.addEventListener("keydown",w=>{const U=w;(U.key==="Enter"||U.key===" ")&&A.classList.contains("error")&&(U.preventDefault(),i.onLampClick())},p),T.appendChild(A);const g=document.createElement("div");g.className="p-status";const y=document.createElement("span"),W=document.createElement("span"),H=document.createElement("span");H.className="mut";const Q=document.createElement("span");Q.className="mut",g.append(y,W,H,Q),g.tabIndex=0,g.setAttribute("role","button"),g.setAttribute("aria-label","定位在途路由与联邦对端"),g.title="定位在途与联邦（回车）",g.addEventListener("click",()=>tt(),p),g.addEventListener("keydown",w=>{const U=w;(U.key==="Enter"||U.key===" ")&&(U.preventDefault(),tt())},p);const re=document.createElement("div");re.className="p-legend";const Y=(w,U,F)=>{const X=document.createElement("span"),le=document.createElement("i");w&&(le.className="dashed"),F!==void 0&&(le.style.borderTopColor=F),X.append(le,document.createTextNode(U)),re.appendChild(X)};Y(!1,"成员边（星形，框→成员）"),Y(!0,"跨队多属（虚线）"),Y(!1,"活动边（inFlight 路由，瞬时）","var(--accent)"),Y(!0,"联邦线（→peer）","var(--federal)");const ne=document.createElement("div");ne.className="p-notice-stack",ne.setAttribute("role","log"),ne.setAttribute("aria-live","polite"),u.append(_,M,S,T,g,re,ne);let V=0,ve=0;const Me=()=>i.viewSize?i.viewSize():{w:u.clientWidth,h:u.clientHeight},ye=()=>{const w=Me();V=w.w,ve=w.h};function ze(){M.style.transform=B_(n);const w=24*n.scale;_.style.backgroundSize=`${w}px ${w}px`,_.style.backgroundPosition=`${-n.x*n.scale}px ${-n.y*n.scale}px`,z.textContent=`${Math.round(n.scale*100)}%`}function Be(){ze(),e.revision!==a&&(a=e.revision,Ee(),Le(),qe()),je()}const j=new Map,ae=new Map;function Ee(){const w=new Set;for(const[U,F]of e.allFrames()){w.add(U);let X=j.get(U);if(X===void 0){X=document.createElement("div"),X.className="p-frame",X.dataset.name=U;const K=document.createElement("div");K.className="p-frame-head",K.dataset.frame=U,K.tabIndex=0,K.setAttribute("role","button"),K.setAttribute("aria-haspopup","menu"),K.setAttribute("aria-label",`团队框 ${U}（拖动整组，回车菜单）`);const $=document.createElement("span");$.className="ttl";const ee=document.createElement("span");ee.className="cnt mono";const ce=document.createElement("span");ce.className="route mono",K.append($,ee,ce),X.appendChild(K),d.appendChild(X),j.set(U,X)}const le=G_(U);X.style.setProperty("--frame-line",le.line),X.style.setProperty("--frame-bg",le.bg),X.style.left=`${F.x}px`,X.style.top=`${F.y}px`,X.style.width=`${F.w}px`,X.style.height=`${F.h}px`;const J=X.querySelector(".ttl"),ge=X.querySelector(".cnt"),v=X.querySelector(".route");J.textContent!==U&&(J.textContent=U);let R=0,L=0;for(const K of e.allNodes())K.memberships.find(ee=>ee.team===U)!==void 0&&(R+=1,K.memberships.length>1&&(L+=1));const I=`${R} 成员`+(L>0?` +${L} 跨队`:"");ge.textContent!==I&&(ge.textContent=I);const C=Oe(U);v.textContent!==C&&(v.textContent=C)}for(const[U,F]of[...j])w.has(U)||(F.remove(),j.delete(U))}function Se(w){const U=P.get(w)??[],F=U.map(ge=>ge.name!==void 0&&ge.name!==""?ge.name:ge.team),X=F.slice(0,2).join("、"),le=F.length>2?` +${F.length-2}`:"",J=vt.get(w);return(J!==void 0?`score ${J} · `:"")+`${U.length} 远端团队`+(X!==""?`：${X}${le}`:"")}function Oe(w){const U=dt.find(F=>F.name===w);return(U==null?void 0:U.team)??w}function Le(){const w=new Set;for(const U of e.allNodes()){w.add(U.id);let F=ae.get(U.id);if(F===void 0){F=document.createElement("div"),F.className="p-node",F.dataset.id=U.id,F.tabIndex=0;const C=document.createElement("div");C.className="nm";const K=document.createElement("span");K.className="dot";const $=document.createElement("span");$.className="nm-text",C.append(K,$);const ee=document.createElement("div");ee.className="sub mono";const ce=document.createElement("span");ce.className="prio mono",F.append(C,ee,ce),E.appendChild(F),ae.set(U.id,F)}const X=yi(U);F.style.left=`${X.x}px`,F.style.top=`${X.y}px`,F.classList.toggle("cold",!U.live),F.classList.toggle("remote",U.remote===!0),F.classList.toggle("selected",e.isSelected(U.id)),F.setAttribute("aria-selected",String(e.isSelected(U.id)));const le=U.id.slice(5),J=U.remote===!0?le:U.name??U.label,ge=F.querySelector(".nm-text");ge.textContent!==J&&(ge.textContent=J);const v=F.querySelector(".sub"),R=U.remote===!0?Se(le):U.team+(U.name!==void 0&&U.name!==""?" · "+U.name:"")+(U.memberships.length>1?` · 跨队×${U.memberships.length}`:"");v.textContent!==R&&(v.textContent=R);const L=F.querySelector(".prio"),I=U.remote===!0?"peer":U.memberships[0]!==void 0?`P${U.memberships[0].index}`:"";L.textContent!==I&&(L.textContent=I)}for(const[U,F]of[...ae])w.has(U)||(F.remove(),ae.delete(U))}function qe(){for(;f.firstChild!==null;)f.firstChild.remove();const w=e.allFrames().map(([U])=>({name:U,members:e.teamMemberIds(U).map(F=>({id:F}))}));for(const U of w_(w,new Map(e.allFrames()),e.positions())){const F=document.createElementNS("http://www.w3.org/2000/svg","line");F.setAttribute("class","e-member"+(U.dashed?" dashed":"")),F.setAttribute("x1",String(U.x1)),F.setAttribute("y1",String(U.y1)),F.setAttribute("x2",String(U.x2)),F.setAttribute("y2",String(U.y2)),f.appendChild(F)}}let $e=[],We=[],P=new Map;const vt=new Map;let Ve=[];function je(){for(const F of $e)F.remove();$e=[];const w=e.allNodes().filter(F=>F.remote===!0).map(F=>({url:F.peerUrl??F.id.slice(5),score:F.score,x:F.x,y:F.y}));We=w;const U=e.contentBounds();if(U!==null){const F=new Map;for(const[X,le]of e.allFrames())F.set(X,{name:X,x:le.x+le.w/2,y:le.y+Ac});for(const X of U_(Ve,F,w,o()))$e.push(...De(X,"e-activity",X.label));for(const X of F_(w,U))$e.push(...De(X,"e-federal",X.label))}}function De(w,U,F){const X=document.createElementNS("http://www.w3.org/2000/svg","line");X.setAttribute("class",U),X.setAttribute("x1",String(w.x1)),X.setAttribute("y1",String(w.y1)),X.setAttribute("x2",String(w.x2)),X.setAttribute("y2",String(w.y2)),f.appendChild(X);const le=[X];if(F!==""){const J=document.createElementNS("http://www.w3.org/2000/svg","text");J.setAttribute("class","edge-label mono"),J.setAttribute("x",String((w.x1+w.x2)/2+14)),J.setAttribute("y",String((w.y1+w.y2)/2+18)),J.textContent=F,f.appendChild(J),le.push(J)}return le}function tt(){n=Dl(O_(e.contentBounds(),We),u.clientWidth||V,u.clientHeight||ve),ze(),i.onDirty()}function Ne(w){var J;const U=w.sessions.filter(ge=>ge.live!==!1).length,F=w.sessions.length-U;y.textContent="";const X=document.createElement("b");X.className="ok",X.textContent=`● ${U} live`,y.appendChild(X),W.textContent="";const le=document.createElement("b");le.className="warn",le.textContent=`● ${F} cold`,W.appendChild(le),H.textContent=`${((J=w.inFlight)==null?void 0:J.length)??0} inFlight`,Q.className="mut",Q.textContent=`${w.teams.length} 队 · ${w.peerCount} peer`}const b=new Map,x=w=>{b.set(w,(b.get(w)??0)+1)},k=w=>{const U=(b.get(w)??0)-1;U<=0?b.delete(w):b.set(w,U)};function q(w){const U=k_(e,w),F=z_(w);x(F),Be(),i.onCanvasAction(w).then(X=>{k(F),X||U(),Be()},()=>{k(F),U(),se("error","操作通道异常，已回滚"),Be()})}function se(w,U){var X;for(;ne.childElementCount>=3;)(X=ne.firstElementChild)==null||X.remove();const F=document.createElement("div");F.className="p-notice"+(w==="error"?" error":""),F.setAttribute("role",w==="error"?"alert":"status"),F.textContent=U,ne.appendChild(F),c.push(setTimeout(()=>F.remove(),4e3))}function Z(){return e.selectedIds().map(w=>{var U;return{id:w,y:((U=e.getNode(w))==null?void 0:U.y)??0}}).sort((w,U)=>w.y-U.y).map(w=>w.id)}function be(){if(he!==null)return;const w=Z().filter(U=>{var F;return((F=e.getNode(U))==null?void 0:F.remote)!==!0});if(w.length<2){se("info","框选至少 2 个会话节点");return}xe(w)}let he=null;function xe(w){const U=document.createElement("div");U.className="p-dialog";const F=document.createElement("div");F.className="p-dialog-panel",F.setAttribute("role","dialog"),F.setAttribute("aria-modal","true"),F.setAttribute("aria-labelledby","p-dialog-title");const X=document.createElement("div");X.id="p-dialog-title",X.className="p-dialog-title",X.textContent=`组建团队（${w.length} 个节点，自上而下即优先级）`;const le=document.createElement("input");le.className="p-dialog-input",le.maxLength=40,le.setAttribute("aria-label","团队名");const J=document.createElement("div");J.className="p-dialog-err",J.setAttribute("aria-live","polite");const ge=document.createElement("div");ge.className="p-dialog-row";const v=document.createElement("button");v.type="button",v.textContent="组建";const R=document.createElement("button");R.type="button",R.textContent="取消",ge.append(v,R),F.append(X,le,J,ge),U.appendChild(F),u.appendChild(U);const L=document.activeElement,I=()=>{U.remove(),he=null,L==null||L.focus()},C=()=>{const $=le.value.trim();return $===""||$.length>40||$.includes("/")||/^\d+$/.test($)?"队名需 1..40 字，不含“/”，不为纯数字":null},K=()=>{const $=C();if($!==null){J.textContent=$,le.focus();return}const ee=le.value.trim();if(I(),e.getFrame(ee)!==void 0){se("info",`已加入现有团队「${ee}」`),q({type:"add-member",team:ee,ids:w});return}q({type:"create-team",name:ee,ids:w,created:!0})};v.addEventListener("click",K),R.addEventListener("click",I),le.addEventListener("keydown",$=>{const ee=$;ee.key==="Enter"&&(ee.preventDefault(),K()),ee.key==="Escape"&&(ee.preventDefault(),I())}),U.addEventListener("keydown",$=>{const ee=$;if(ee.key==="Escape"){ee.preventDefault(),ee.stopPropagation(),I();return}if(ee.key!=="Tab")return;ee.preventDefault();const ce=Array.from(F.querySelectorAll("input, button")),we=ce.indexOf(document.activeElement),Re=ee.shiftKey?ce[(we-1+ce.length)%ce.length]:ce[(we+1)%ce.length];Re==null||Re.focus()},p),he={wrap:U,restoreFocus:L},le.focus()}let Fe=null,oe="root",fe=null;function Pe(){Fe==null||Fe.remove(),Fe=null,oe="root",fe!==null&&fe.isConnected?fe.focus():u.focus(),fe=null}function Ae(w,U,F){const X=document.createElement("button");return X.type="button",X.setAttribute("role","menuitem"),X.textContent=w,U?X.addEventListener("click",()=>{Pe(),F()}):(X.disabled=!0,X.setAttribute("aria-disabled","true")),X}function pe(w,U,F,X="root"){var v,R,L,I,C;fe===null&&(fe=F.kind==="node"?ae.get(F.id)??null:j.get(F.name)??null),Fe==null||Fe.remove(),oe=X;const le=document.createElement("div");le.className="p-menu",le.setAttribute("role","menu"),le.setAttribute("aria-label","团队操作");let J=[];if(F.kind==="frame")J=[Ae(`解散团队「${F.name}」`,!0,()=>q({type:"remove-team",name:F.name}))];else{const K=F.id;if(X==="root"){const $=Ae("组成团队…",e.selectedIds().length>=2,()=>xe(Z()));$.title="先框选或 Shift 加选至少 2 个节点",J.push($),dt.length>0&&(J.push(Ae("加入团队 ▸",!0,()=>pe(w,U,F,"join"))),(((v=e.getNode(K))==null?void 0:v.memberships.map(ce=>ce.team))??[]).length>0&&(J.push(Ae("置顶路由 ▸",!0,()=>pe(w,U,F,"promote"))),J.push(Ae("离队 ▸",!0,()=>pe(w,U,F,"leave")))))}else{J.push(Ae("‹ 返回",!0,()=>pe(w,U,F,"root")));for(const $ of dt)if(X==="join"){const ee=((R=e.getNode(K))==null?void 0:R.memberships.some(ce=>ce.team===$.name))??!0;J.push(Ae(ee?`${$.name}（已加入）`:$.name,!ee,()=>q({type:"add-member",team:$.name,ids:[K]})))}else if(X==="leave"){const ee=((L=e.getNode(K))==null?void 0:L.memberships.some(ce=>ce.team===$.name))??!1;J.push(Ae($.name,ee,()=>q({type:"remove-member",team:$.name,ids:[K]})))}else{const ee=((I=e.getNode(K))==null?void 0:I.memberships.some(ce=>ce.team===$.name))??!1;J.push(Ae($.name,ee,()=>{const ce=e.teamMemberIds($.name),we=[K,...ce.filter(Re=>Re!==K)];q({type:"reorder",team:$.name,ops:Kr(ce,we)})}))}}}le.append(...J),le.style.left=`${Math.min(w,window.innerWidth-200)}px`;const ge=J.length*30+8;le.style.top=`${Math.max(8,Math.min(U,window.innerHeight-ge-8))}px`,le.addEventListener("keydown",K=>{var we,Re,Te,Ze;const $=K,ee=Array.from(le.querySelectorAll("[role=menuitem]")),ce=ee.indexOf(document.activeElement);$.key==="ArrowDown"?($.preventDefault(),(we=ee[(ce+1+ee.length)%ee.length])==null||we.focus()):$.key==="ArrowUp"?($.preventDefault(),(Re=ee[(ce-1+ee.length)%ee.length])==null||Re.focus()):$.key==="Home"?($.preventDefault(),(Te=ee[0])==null||Te.focus()):$.key==="End"?($.preventDefault(),(Ze=ee[ee.length-1])==null||Ze.focus()):$.key==="Escape"&&($.preventDefault(),$.stopPropagation(),oe!=="root"?pe(w,U,F,"root"):Pe())}),u.appendChild(le),Fe=le,(C=J[0])==null||C.focus()}function ke(w,U,F){var ge;if(he!==null)return;const X=(F==null?void 0:F.closest(".p-node"))??null;if(X!==null&&((ge=e.getNode(X.dataset.id??""))==null?void 0:ge.remote)===!0)return;const le=X,J=(F==null?void 0:F.closest(".p-frame-head"))??null;if(le!==null){const v=le.dataset.id??"";e.isSelected(v)||e.setSelection([v]),fe=le,pe(w,U,{kind:"node",id:v})}else J!==null&&(fe=J,pe(w,U,{kind:"frame",name:J.dataset.frame??""}))}function Ie(w){const U=u.getBoundingClientRect();return{x:w.clientX-U.left,y:w.clientY-U.top}}function nt(w,U){var ge;const F=Ie(U),X=kn(n,F.x,F.y),le=Il(new Map(e.allFrames()),X),J=w.ids.filter(v=>{var R;return((R=e.getNode(v))==null?void 0:R.remote)!==!0});if(le!==void 0){const v=J.filter(R=>{var L;return!((L=e.getNode(R))!=null&&L.memberships.some(I=>I.team===le))});if(v.length>0){q({type:"add-member",team:le,ids:v});return}if(w.ids.length===1&&((ge=e.getNode(w.clicked))==null?void 0:ge.remote)!==!0){const R=e.teamMemberIds(le),L=H_(e,le);L.join("\0")!==R.join("\0")&&q({type:"reorder",team:le,ops:Kr(R,L)})}return}for(const v of w.origins)q({type:"remove-member",team:v.team,ids:[...v.ids]})}function N(w){var J;if(V===0&&ye(),he!==null){w.preventDefault();return}const U=w.target;if(Fe!==null){if(U!==null&&U.closest(".p-menu")!==null)return;Pe(),w.preventDefault();return}const F=Ie(w);if(w.button===2){h={x:F.x,y:F.y,target:w.target,moved:!1},w.preventDefault();try{u.setPointerCapture(w.pointerId??0)}catch{}return}if(U!==null&&(U.closest("button")!==null||U.closest(".p-lamp")!==null||U.closest(".p-status")!==null))return;const X=U!==null?U.closest(".p-node"):null,le=U!==null?U.closest(".p-frame-head"):null;if((X!==null||le!==null)&&w.button===1){s={kind:"pan",last:F,moved:!1},w.preventDefault();try{u.setPointerCapture(w.pointerId??0)}catch{}return}if(X!==null){if(w.button!==0)return;const ge=X.dataset.id??"",v=e.isSelected(ge);!v&&!w.shiftKey&&e.setSelection([ge]);const R=w.shiftKey||v?e.isSelected(ge)?e.selectedIds():[...e.selectedIds(),ge]:[ge],L=new Map;for(const I of R)for(const C of((J=e.getNode(I))==null?void 0:J.memberships)??[])L.set(C.team,[...L.get(C.team)??[],I]);s={kind:"node",clicked:ge,ids:R,last:kn(n,F.x,F.y),moved:!1,el:X,origins:[...L].map(([I,C])=>({team:I,ids:C}))},X.classList.add("dragging")}else if(le!==null){if(w.button!==0)return;const ge=le.dataset.frame??"",v=e.beginFrameDrag(ge);if(v===void 0)return;s={kind:"frame",name:ge,snap:v,origin:kn(n,F.x,F.y),moved:!1}}else if(w.button===1||w.button===0&&r)s={kind:"pan",last:F,moved:!1};else if(w.button===0)s={kind:"marquee",origin:F,last:F,additive:w.shiftKey},S.style.display="block",S.style.left=`${F.x}px`,S.style.top=`${F.y}px`,S.style.width="0px",S.style.height="0px";else return;w.preventDefault();try{u.setPointerCapture(w.pointerId??0)}catch{}}function me(w){const U=Ie(w);if(h!==null){const F=U.x-h.x,X=U.y-h.y;Math.hypot(F,X)>4&&(h.moved=!0,n=qr(jr(n,F,X)),h.x=U.x,h.y=U.y,ze());return}if(s.kind==="node"){const F=kn(n,U.x,U.y),X=F.x-s.last.x,le=F.y-s.last.y;if(X===0&&le===0)return;s.moved=!0,s.last=F,e.dragNodes(s.ids,X,le);const J=Il(new Map(e.allFrames()),F),ge=s.ids.filter(R=>{var L;return((L=e.getNode(R))==null?void 0:L.remote)!==!0}),v=J!==void 0&&ge.length>0;for(const[R,L]of j)L.classList.toggle("drop-target",v&&R===J);Be()}else if(s.kind==="frame"){const F=kn(n,U.x,U.y),X=F.x-s.origin.x,le=F.y-s.origin.y;if(!s.moved&&X===0&&le===0)return;s.moved=!0,e.applyFrameDrag(s.snap,X,le),Be()}else if(s.kind==="pan")n=jr(n,U.x-s.last.x,U.y-s.last.y),s.last=U,s.moved=!0,ze();else if(s.kind==="marquee"){const F=Math.min(s.origin.x,U.x),X=Math.min(s.origin.y,U.y);S.style.left=`${F}px`,S.style.top=`${X}px`,S.style.width=`${Math.abs(U.x-s.origin.x)}px`,S.style.height=`${Math.abs(U.y-s.origin.y)}px`,s.last=U}}function G(w){var U;if(h!==null){const F=h.moved,X=h.target,le=h.x,J=h.y;h=null,F?(m=!0,i.onDirty()):X!==null&&ke(le,J,X);return}if(s.kind==="node"){const F=s.clicked;if(s.moved)nt(s,w),i.onDirty();else if(w.shiftKey){const X=e.selectedIds();e.setSelection(X.includes(F)?X.filter(le=>le!==F):[...X,F])}else e.setSelection([F]);for(const X of j.values())X.classList.remove("drop-target");(U=s.el)==null||U.classList.remove("dragging"),Be()}else if(s.kind==="frame")s.moved&&i.onDirty();else if(s.kind==="pan")s.moved&&i.onDirty();else if(s.kind==="marquee"){const F=s.last,X=kn(n,Math.min(s.origin.x,F.x),Math.min(s.origin.y,F.y)),le=kn(n,Math.max(s.origin.x,F.x),Math.max(s.origin.y,F.y));e.marqueeSelect({x:X.x,y:X.y,w:le.x-X.x,h:le.y-X.y},s.additive),S.style.display="none",Be()}s={kind:"none"};try{u.releasePointerCapture(w.pointerId??0)}catch{}}function te(w){Fe!==null&&Pe();const U=Ie(w);if(w.ctrlKey){const F=w.deltaMode===1?16:1,X=Math.exp(-((w.deltaY??0)*F)*.0015);n=Ll(n,X,U.x,U.y)}else{const F=w.deltaMode===1?16:1;n=qr(jr(n,(w.deltaX??0)*F,(w.deltaY??0)*F))}w.preventDefault(),ze(),i.onDirty()}function de(w){ye(),n=Ll(n,w,V/2,ve/2),ze(),i.onDirty()}function _e(){ye(),n=Dl(e.contentBounds(),V,ve),ze(),i.onDirty()}function Xe(w){var J,ge,v,R,L;if(he!==null||w.ctrlKey||w.metaKey)return;if(Fe!==null){w.key==="Escape"&&(Pe(),w.preventDefault());return}if(w.key===" "&&w.target===u){r=!0,w.preventDefault();return}const U=((ge=(J=w.target)==null?void 0:J.closest)==null?void 0:ge.call(J,".p-frame-head"))??null;if((w.key==="Enter"||w.key===" ")&&U!==null){w.preventDefault();const I=U.getBoundingClientRect();ke(I.left+I.width/2,I.top+I.height/2,U);return}if(w.key===" "&&((R=(v=w.target)==null?void 0:v.classList)!=null&&R.contains("p-node"))){const C=w.target.dataset.id??"",K=e.selectedIds();e.setSelection(K.includes(C)?K.filter($=>$!==C):[...K,C]),Be(),w.preventDefault();return}if(w.key==="F10"&&w.shiftKey||w.key==="ContextMenu"){w.preventDefault();const I=document.activeElement??null,C=((L=I==null?void 0:I.getBoundingClientRect)==null?void 0:L.call(I))??{left:0,top:0,width:0,height:0};ke(C.left+C.width/2,C.top+C.height/2,I);return}if(w.key==="Delete"||w.key==="Backspace"){w.preventDefault(),ot();return}if(w.altKey&&(w.key==="ArrowUp"||w.key==="ArrowDown")){w.preventDefault(),Mt(w.key==="ArrowUp");return}if(w.key==="g"||w.key==="G"){be();return}if(w.key==="0"){_e();return}if(w.key==="="||w.key==="+"){de(1.2);return}if(w.key==="-"){de(1/1.2);return}if(w.key==="Escape"){if(Fe!==null){Pe(),Be();return}e.setSelection([]),Be();return}const F=w.shiftKey?40:8,le={ArrowLeft:[-F,0],ArrowRight:[F,0],ArrowUp:[0,-F],ArrowDown:[0,F]}[w.key];if(le!==void 0){w.preventDefault();const I=e.selectedIds();I.length>0&&(e.nudge(I,le[0],le[1]),Be(),i.onDirty())}}function ot(){var X,le,J;const w=document.activeElement,U=((X=w==null?void 0:w.closest)==null?void 0:X.call(w,".p-frame-head"))??null,F=((le=w==null?void 0:w.closest)==null?void 0:le.call(w,".p-node"))??null;if(U!==null){q({type:"remove-team",name:U.dataset.frame??""});return}if(F!==null){const ge=F.dataset.id??"",v=((J=e.getNode(ge))==null?void 0:J.memberships.map(R=>R.team))??[];if(v.length===0){se("info","该节点未加入任何团队");return}if(v.length===1){q({type:"remove-member",team:v[0],ids:[ge]});return}fe=F,pe(window.innerWidth/2,window.innerHeight/2,{kind:"node",id:ge},"leave");return}se("info","焦点不在节点或团队框上")}function Mt(w){var I,C;const U=document.activeElement,F=((I=U==null?void 0:U.closest)==null?void 0:I.call(U,".p-node"))??null;if(F===null)return;const X=F.dataset.id??"",le=((C=e.getNode(X))==null?void 0:C.memberships)??[];if(le.length!==1)return;const J=le[0].team,ge=e.teamMemberIds(J),v=ge.indexOf(X),R=w?Math.max(0,v-1):Math.min(ge.length-1,v+1);if(R===v)return;const L=[...ge];L.splice(v,1),L.splice(R,0,X),q({type:"reorder",team:J,ops:Kr(ge,L)})}function Ke(w){w.key===" "&&(r=!1)}u.addEventListener("pointerdown",w=>N(w),p),u.addEventListener("pointermove",w=>me(w),p),u.addEventListener("pointerup",w=>G(w),p),u.addEventListener("wheel",w=>te(w),{...p,passive:!1}),u.addEventListener("keydown",w=>Xe(w),p),u.addEventListener("keyup",w=>Ke(w),p),u.addEventListener("contextmenu",w=>{const U=w;if(U.preventDefault(),U.preventDefault(),m){m=!1;return}ke(U.clientX,U.clientY,U.target)},p);let dt=[];function Gt(w){dt=w.teams,w.peers,Ve=w.inFlight??[];const U=new Map;for(const J of w.teams)for(let ge=0;ge<J.members.length;ge++){const v=J.members[ge].id,R=U.get(v)??[];R.push({team:J.name,index:ge}),U.set(v,R)}const F=new Set,X=J=>{var L;const ge=U.get(J)??[];if(b.size===0)return ge;const v=ge.filter(I=>!b.has(I.team)),R=(((L=e.getNode(J))==null?void 0:L.memberships)??[]).filter(I=>b.has(I.team));return[...v,...R]};for(const J of w.sessions)if(J.joined===!0)if(F.add(J.id),e.getNode(J.id)!==void 0)e.upsertNode({id:J.id,x:e.getNode(J.id).x,y:e.getNode(J.id).y,label:J.label,team:J.team,name:J.name,live:J.live!==!1,memberships:X(J.id)});else{const ge=t==null?void 0:t.nodes[J.id];let v,R;if(ge!==void 0)v=ge.x,R=ge.y;else{const L=es(J.id);v=L.x,R=L.y}e.upsertNode({id:J.id,x:v,y:R,label:J.label,team:J.team,name:J.name,live:J.live!==!1,memberships:X(J.id)})}for(const J of e.nodeIds())!F.has(J)&&!J.startsWith("peer-")&&e.removeNode(J);const le=new Set;P=C_(w.remoteTeams??[]),vt.clear();for(const J of w.peers??[])vt.set(co(J.url),J.score);if(w.peers!==void 0){const J=e.contentBounds(),ge=N_(w.peers,J);w.peers.forEach((v,R)=>{var $,ee;const L=R_(v.url);le.add(L);const I=t==null?void 0:t.nodes[L],C=e.getNode(L),K=C!==void 0?{x:C.x,y:C.y}:I!==void 0?{x:I.x,y:I.y}:{x:(($=ge[R])==null?void 0:$.x)??200,y:((ee=ge[R])==null?void 0:ee.y)??0};e.upsertNode({id:L,x:K.x,y:K.y,label:v.url,team:"",name:v.url,peerUrl:v.url,live:!0,remote:!0,memberships:[]}),e.upsertScore(L,v.score)})}for(const J of e.nodeIds())J.startsWith("peer-")&&!le.has(J)&&e.removeNode(J);for(const J of w.teams){if(e.getFrame(J.name)!==void 0||b.has(J.name))continue;const ge=t==null?void 0:t.frames[J.name];if(ge!==void 0){e.setFrame(J.name,{...ge});continue}const v=[];for(const R of J.members){const L=e.getNode(R.id);L!==void 0&&v.push(yi(L))}v.length>0&&e.setFrame(J.name,oo(v))}for(const[J]of e.allFrames())b.has(J)||w.teams.some(ge=>ge.name===J)||e.removeFrame(J);Ne(w),Be()}function es(w){return Tc(w)}function ts(w){const U=Ec(w);U!==void 0&&(t=U,s.kind==="none"&&(n=qr({...U.viewport})),a=-1,Be())}function nn(){return y_(n,e.positions(),e.frameRects())}function Ii(w,U){A.classList.remove("pending","saved","error"),w==="pending"&&A.classList.add("pending"),w==="saved"&&A.classList.add("saved"),w==="error"&&A.classList.add("error"),w==="error"?(A.tabIndex=0,A.setAttribute("role","button"),A.setAttribute("aria-label","布局保存失败，按回车重试")):(A.removeAttribute("tabindex"),A.removeAttribute("role"),A.removeAttribute("aria-label"));const F=w==="pending"?"布局待保存…":w==="saved"?`布局已保存 ${U??""}`.trimEnd():w==="error"?"保存失败 · 回车重试":"布局";ie.textContent=F}function ns(){u.style.display="block",ye(),ze(),u.focus()}function is(){u.style.display="none"}function Jn(){l.abort();for(const w of c)clearTimeout(w)}return{root:u,reconcile:Gt,activate:ns,deactivate:is,adoptExternalLayout:ts,snapshotDoc:nn,setLamp:Ii,notice:se,destroy:Jn,seam:{pointerDown:N,pointerMove:me,pointerUp:G,wheel:te,key:Xe,keyUp:Ke,contextMenu(w){w.preventDefault(),ke(w.clientX,w.clientY,w.target)}}}}const W_=800;function X_(i){let e,t=!1,n=!1,s=!1,r="idle";function a(h){h!==r&&(r=h,i.onLamp(h))}function o(){e!==void 0&&(e(),e=void 0)}function l(){o(),e=i.schedule(()=>{e=void 0,c(!1)},W_)}async function c(h){if(t){n=!0;return}t=!0,o();const m=i.snapshot();let p;try{p=JSON.stringify(m)}catch{t=!1,a("error"),i.onHttpError("layout document is not JSON-serializable");return}try{const u=await i.send(m,{keepalive:h});if(u===null||typeof u!="object"||u.ok!==!0){a("error");const _=u!==null&&typeof u=="object"&&typeof u.error=="string"?u.error:"layout save refused";i.onHttpError(`layout save: ${_}`)}else JSON.stringify(i.snapshot())===p&&(i.onAdopt(u.layout),a("saved"))}catch(u){a("error"),i.onHttpError(`layout save unreachable: ${String((u==null?void 0:u.message)??u).slice(0,80)}`)}if(t=!1,r==="error"){s=!1;return}if(s){s=!1,c(!0);return}n&&(n=!1,a("pending"),l())}return{markDirty(){if(n=!1,a("pending"),t){n=!0;return}l()},retry(){r!=="error"||t||(a("pending"),c(!1))},flush(){if(t){s=!0,n=!0;return}o(),c(!0)},isBusy(){return t},dispose(){o()}}}const Y_=20;function q_(i,e,t=Y_){const n=new Map;let s=0,r=0;for(const h of i){const m=e[h],p=m!==void 0&&Number.isFinite(m.x)&&Number.isFinite(m.y)?{x:m.x,y:m.y}:j_(h);n.set(h,p),s+=p.x,r+=p.y}const a=n.size;if(a===0)return n;s/=a,r/=a;let o=0;for(const h of n.values())o=Math.max(o,Math.hypot(h.x-s,h.y-r));const l=o>0?t/o:0,c=new Map;for(const[h,m]of n)c.set(h,{x:(m.x-s)*l,y:(m.y-r)*l});return c}function j_(i){const e=b_(i);return{x:e.x,y:e.z}}function Nl(i){return typeof i.error=="string"?i.error:void 0}function K_(i){const e=new Map;let t=0;function n(a,o){t+=1;const l=e.get(a)??Promise.resolve(),c=async()=>{try{return await o()}finally{t-=1}},h=l.then(c,c);return e.set(a,h.then(()=>{},()=>{})),h}async function s(a){let o;try{o=await i.send(a)}catch(c){const h=String((c==null?void 0:c.message)??c).slice(0,80);return i.onNotice("error",`画布不可达：${h}`),!1}if(o.status>=400)return i.onNotice("error",Nl(o.body)??`HTTP ${o.status}`),!1;if(o.body.ok===!0)return!0;const l=Nl(o.body);return l!==void 0?(i.onNotice("error",l),!1):!0}async function r(a,o){for(const l of o)if(!await s({...a,id:l}))return!1;return!0}return{createTeam(a,o,l=!1){return n(a,async()=>{if(!await s({action:"create",name:a}))return!1;for(let c=0;c<o.length;c++)if(!await s({action:"add-member",name:a,id:o[c]}))return l&&c===0&&await s({action:"remove",name:a}),!1;return!0})},addMembers(a,o){return n(a,()=>r({action:"add-member",name:a},o))},removeMembers(a,o){return n(a,()=>r({action:"remove-member",name:a},o))},runRosterOps(a,o){return n(a,async()=>{for(const l of o){const c=l.op==="remove"?{action:"remove-member",name:a,id:l.id}:{action:"add-member",name:a,id:l.id};if(!await s(c))return!1}return!0})},removeTeam(a){return n(a,()=>s({action:"remove",name:a}))},hasPending(){return t>0}}}const Nt=document.getElementById("app"),Ht=new Om({antialias:!0});Ht.setSize(Nt.clientWidth||window.innerWidth,Nt.clientHeight||window.innerHeight);Ht.setPixelRatio(Math.min(window.devicePixelRatio,2));Nt.appendChild(Ht.domElement);const Yi=document.createElement("div");Yi.className="nexus-fault";Nt.appendChild(Yi);const{fault:zs,clear:$_}=c_({show(i){Yi.textContent=i,Yi.style.display="block"},hide(){Yi.style.display="none"}},i=>console.error(i)),mn=new l_;mn.setSize(Nt.clientWidth||window.innerWidth,Nt.clientHeight||window.innerHeight);mn.domElement.style.position="absolute";mn.domElement.style.top="0";mn.domElement.style.pointerEvents="none";Nt.appendChild(mn.domElement);const $t=new Bm;$t.background=new Ye(h_.bg0);$t.fog=new to(395794,.005);const Kn=new Bt(60,Nt.clientWidth/Nt.clientHeight,.1,500);Kn.position.set(0,35,55);const Z_=vc();let ks;const Rn=new jm(Kn,Ht.domElement);Rn.enableDamping=!Z_;Rn.dampingFactor=.06;Rn.minDistance=8;Rn.maxDistance=180;$t.add(new Vm(3359846,1.6));const wc=new _c(16777215,1.7);wc.position.set(25,50,25);$t.add(wc);const Rc=new _c(9133302,.35);Rc.position.set(-25,-10,-20);$t.add(Rc);const Cc=new Xm(120,60,1845056,1120814);Cc.position.y=-16;$t.add(Cc);const js=new An,Vi=new An,Wi=new An,Xi=new An;$t.add(Vi,js,Wi,Xi);new Di({color:2282478,transparent:!0,opacity:.6});const J_=new Di({color:16096779,transparent:!0,opacity:.65});function Q_(i,e){const t=new no(e,1),n=new pc({color:i,emissive:i,emissiveIntensity:.7,roughness:.3});return new kt(t,n)}async function eg(){try{const i=await fetch("/__dsh_a2a/canvas-layout",{cache:"no-store"});return i.ok?(await i.json()).layout??null:null}catch{return null}}const Qt=new Map,$r=new Map,Ks=new Map,$s=new Map;async function uo(){var p;let i;try{i=await fetch("/__dsh_a2a/state",{cache:"no-store"})}catch(u){zs(`state unreachable: ${String((u==null?void 0:u.message)??u).slice(0,80)}`);return}if(!i.ok){zs(`state ${i.status} from host`);return}$_();let e;try{e=await i.json()}catch(u){zs(`state JSON parse failed: ${String((u==null?void 0:u.message)??u).slice(0,80)}`);return}const t=(e.sessions??[]).filter(u=>u.joined===!0),n=((p=e.canvas)==null?void 0:p.teams)??[],s=(e.peers??[]).filter(u=>u!==null&&typeof u=="object"&&typeof u.url=="string"),r=(e.inFlight??[]).filter(u=>u!==null&&typeof u=="object"&&typeof u.team=="string"&&typeof u.peer=="string"&&Number.isFinite(u.startedAt)),a=await eg(),o=new Set(t.map(u=>u.id));for(const[u,_]of[...Qt])if(!o.has(u)){const M=$r.get(u);M&&__(M),Rs([_]),_.material instanceof Zn&&_.material.dispose(),js.remove(_),Qt.delete(u),Ks.delete(u),$s.delete(u)}for(let u=0;u<t.length;u++){const _=t[u],M=_.id,f=_.live!==!1;let d=Qt.get(M);if(!d){const E=f?El.nodeLive:El.nodeCold;d=Q_(E,f?.9:.5),d.userData={label:_.name??_.label,sid:M},js.add(d),Qt.set(M,d)}$r.has(M)||$r.set(M,m_(d,_.name??_.label,f,_.team)),$s.set(M,_.team),Ks.set(M,_)}const l=q_(t.map(u=>u.id),(a==null?void 0:a.nodes)??{});for(const[u,_]of Qt){const M=l.get(u);M!==void 0&&_.position.set(M.x,0,M.y)}Rs(Xi.children),Rs(Vi.children),Vi.clear(),Rs(Wi.children),Wi.clear(),d_(n,Qt,Xi,Vi),f_(s,Wi,Xi);const c=r;for(const u of c){const _=Vi.children.find(d=>{var E;return((E=d.userData)==null?void 0:E.team)===u.team}),M=Wi.children.find(d=>{var E;return((E=d.userData)==null?void 0:E.peer)===u.peer});if(_===void 0||M===void 0)continue;const f=new Ut().setFromPoints([_.position.clone(),M.position.clone()]);Xi.add(new rr(f,J_))}v_(Ht.domElement,t,n,s),ks==null||ks.renderOnce();const h=JSON.stringify(a??null);h!==Ul&&(Ul=h,(Ga==="idle"||Ga==="saved")&&!Zs.isBusy()&&fn.adoptExternalLayout(a));const m=(e.remote??[]).filter(u=>u!==null&&typeof u=="object"&&typeof u.team=="string"&&typeof u.via=="string").map(u=>({team:u.team,name:u.name,via:u.via,workspace:u.workspace}));fn.reconcile({sessions:t,teams:n,peerCount:s.length,peers:s,inFlight:r,remoteTeams:m}),Zr=e.canvas!==void 0,Qi.style.display=Zr?"":"none",!Zr&&lr==="plan"&&cr("scene")}let lr="scene",Zr=!1,Ga="idle",Ul;const Hi=K_({send:async i=>{const e=await fetch("/__dsh_a2a/canvas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(i),cache:"no-store"});return{status:e.status,body:await e.json()}},onNotice:(i,e)=>fn.notice(i,e)});function tg(i){switch(i.type){case"create-team":return Hi.createTeam(i.name,i.ids,i.created);case"add-member":return Hi.addMembers(i.team,i.ids);case"remove-member":return Hi.removeMembers(i.team,i.ids);case"remove-team":return Hi.removeTeam(i.name);case"reorder":return Hi.runRosterOps(i.team,i.ops)}}const fn=V_({onDirty:()=>Zs.markDirty(),onLampClick:()=>Zs.retry(),onCanvasAction:async i=>{const e=await tg(i);return uo(),e}});Nt.appendChild(fn.root);const Zs=X_({snapshot:()=>fn.snapshotDoc(),send:(i,e)=>fetch("/__dsh_a2a/canvas-layout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",layout:i}),cache:"no-store",keepalive:e.keepalive}).then(async t=>await t.json()),schedule:(i,e)=>{const t=setTimeout(i,e);return()=>{clearTimeout(t)}},now:Date.now,onLamp:i=>{Ga=i;const e=new Date,t=String(e.getHours()).padStart(2,"0")+":"+String(e.getMinutes()).padStart(2,"0");fn.setLamp(i,t)},onAdopt:i=>{fn.adoptExternalLayout(i)},onHttpError:i=>zs(i)});window.addEventListener("pagehide",()=>Zs.flush());const Ji=document.createElement("div");Ji.className="nexus-modes";Ji.setAttribute("role","tablist");Ji.setAttribute("aria-label","舞台模式");const Pc=(i,e)=>{const t=document.createElement("button");return t.type="button",t.textContent=i,t.title=e,t.setAttribute("role","tab"),t},Js=Pc("观测","3D 拓扑观测模式"),Qi=Pc("规划","2D 无限画布 · 规划模式");Qi.style.display="none";Ji.append(Js,Qi);Nt.appendChild(Ji);function cr(i){lr=i,Js.setAttribute("aria-selected",String(i==="scene")),Qi.setAttribute("aria-selected",String(i==="plan")),Ht.domElement.tabIndex=i==="scene"?0:-1,i==="plan"?(Ei=void 0,so(),mn.domElement.style.display="none",fn.activate()):(mn.domElement.style.display="",fn.deactivate(),Js.focus())}Js.addEventListener("click",()=>cr("scene"));Qi.addEventListener("click",()=>cr("plan"));cr("scene");setInterval(()=>void uo(),5e3);uo();const Fl=new Wm,Jr=new Ue;let Ei;Ht.domElement.addEventListener("pointerdown",i=>{const e=Ht.domElement.getBoundingClientRect();Jr.x=(i.clientX-e.left)/e.width*2-1,Jr.y=-((i.clientY-e.top)/e.height)*2+1,Fl.setFromCamera(Jr,Kn);const t=Fl.intersectObjects(js.children,!1)[0];if(t){const n=t.object.userData;Ei=n.sid;const s=n.sid!==void 0?Ks.get(n.sid):void 0,r=s?s.live!==!1?"live":"cold":"?";xc(Nt,(n.label??"")+" · "+r+" · 团队 "+((s==null?void 0:s.team)??$s.get(n.sid??"")??"?"))}else Ei=void 0,so()});Ht.domElement.addEventListener("keydown",x_({pinned:()=>Ei,ids:()=>[...Qt.keys()],nextAfter:i=>{const e=i!==void 0?[...Qt.keys()].indexOf(i):-1;return[...Qt.keys()][(e+1)%[...Qt.keys()].length]},pin:i=>{const e=Ks.get(i),t=$s.get(i)??"?",n=e?e.live!==!1?"live":"cold":"?";Ei=i,xc(Nt,i+" · "+n+" · 团队 "+t)},escape:()=>{Ei=void 0,so()}},Ht.domElement));function ng(){lr==="scene"&&(mn.render($t,Kn),Ht.render($t,Kn))}if(vc())ks=M_(Rn,ng),Rn.addEventListener("change",()=>Rn.update());else{let i=function(){requestAnimationFrame(i),lr==="scene"&&(Rn.update(),mn.render($t,Kn),Ht.render($t,Kn))};i()}
