var Ic=Object.defineProperty;var Nc=(i,e,t)=>e in i?Ic(i,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):i[e]=t;var Zn=(i,e,t)=>Nc(i,typeof e!="symbol"?e+"":e,t);(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function t(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(s){if(s.ep)return;s.ep=!0;const r=t(s);fetch(s.href,r)}})();/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Xo="169",mi={ROTATE:0,DOLLY:1,PAN:2},fi={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Uc=0,ma=1,Fc=2,Bl=1,Oc=2,sn=3,An=0,Et=1,rn=2,bn=0,_i=1,_a=2,ga=3,va=4,Bc=5,On=100,zc=101,kc=102,Hc=103,Gc=104,Vc=200,Wc=201,Xc=202,Yc=203,Qr=204,eo=205,qc=206,jc=207,Kc=208,$c=209,Zc=210,Jc=211,Qc=212,eu=213,tu=214,to=0,no=1,io=2,Si=3,so=4,ro=5,oo=6,ao=7,zl=0,nu=1,iu=2,Tn=0,su=1,ru=2,ou=3,au=4,lu=5,cu=6,uu=7,kl=300,yi=301,Ei=302,lo=303,co=304,Js=306,uo=1e3,zn=1001,ho=1002,Ut=1003,hu=1004,is=1005,Gt=1006,fr=1007,kn=1008,cn=1009,Hl=1010,Gl=1011,Vi=1012,Yo=1013,Hn=1014,on=1015,Wi=1016,qo=1017,jo=1018,bi=1020,Vl=35902,Wl=1021,Xl=1022,Wt=1023,Yl=1024,ql=1025,gi=1026,Ti=1027,jl=1028,Ko=1029,Kl=1030,$o=1031,Zo=1033,Ps=33776,Ls=33777,Ds=33778,Is=33779,fo=35840,po=35841,mo=35842,_o=35843,go=36196,vo=37492,xo=37496,Mo=37808,So=37809,yo=37810,Eo=37811,bo=37812,To=37813,Ao=37814,wo=37815,Ro=37816,Co=37817,Po=37818,Lo=37819,Do=37820,Io=37821,Ns=36492,No=36494,Uo=36495,$l=36283,Fo=36284,Oo=36285,Bo=36286,du=3200,fu=3201,Zl=0,pu=1,Sn="",qt="srgb",Rn="srgb-linear",Jo="display-p3",Qs="display-p3-linear",ks="linear",nt="srgb",Hs="rec709",Gs="p3",Jn=7680,xa=519,mu=512,_u=513,gu=514,Jl=515,vu=516,xu=517,Mu=518,Su=519,Ma=35044,Sa="300 es",an=2e3,Vs=2001;class Xn{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const s=this._listeners[e];if(s!==void 0){const r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const n=this._listeners[e.type];if(n!==void 0){e.target=this;const s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}}const gt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Us=Math.PI/180,zo=180/Math.PI;function Xi(){const i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(gt[i&255]+gt[i>>8&255]+gt[i>>16&255]+gt[i>>24&255]+"-"+gt[e&255]+gt[e>>8&255]+"-"+gt[e>>16&15|64]+gt[e>>24&255]+"-"+gt[t&63|128]+gt[t>>8&255]+"-"+gt[t>>16&255]+gt[t>>24&255]+gt[n&255]+gt[n>>8&255]+gt[n>>16&255]+gt[n>>24&255]).toLowerCase()}function Mt(i,e,t){return Math.max(e,Math.min(t,i))}function yu(i,e){return(i%e+e)%e}function pr(i,e,t){return(1-t)*i+t*e}function Pi(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function St(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}const Eu={DEG2RAD:Us};class Le{constructor(e=0,t=0){Le.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Mt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Fe{constructor(e,t,n,s,r,o,a,l,c){Fe.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c)}set(e,t,n,s,r,o,a,l,c){const u=this.elements;return u[0]=e,u[1]=s,u[2]=a,u[3]=t,u[4]=r,u[5]=l,u[6]=n,u[7]=o,u[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],u=n[4],_=n[7],m=n[2],h=n[5],g=n[8],M=s[0],p=s[3],d=s[6],b=s[1],y=s[4],w=s[7],B=s[2],I=s[5],P=s[8];return r[0]=o*M+a*b+l*B,r[3]=o*p+a*y+l*I,r[6]=o*d+a*w+l*P,r[1]=c*M+u*b+_*B,r[4]=c*p+u*y+_*I,r[7]=c*d+u*w+_*P,r[2]=m*M+h*b+g*B,r[5]=m*p+h*y+g*I,r[8]=m*d+h*w+g*P,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8];return t*o*u-t*a*c-n*r*u+n*a*l+s*r*c-s*o*l}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8],_=u*o-a*c,m=a*l-u*r,h=c*r-o*l,g=t*_+n*m+s*h;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const M=1/g;return e[0]=_*M,e[1]=(s*c-u*n)*M,e[2]=(a*n-s*o)*M,e[3]=m*M,e[4]=(u*t-s*l)*M,e[5]=(s*r-a*t)*M,e[6]=h*M,e[7]=(n*l-c*t)*M,e[8]=(o*t-n*r)*M,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+e,-s*c,s*l,-s*(-c*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(mr.makeScale(e,t)),this}rotate(e){return this.premultiply(mr.makeRotation(-e)),this}translate(e,t){return this.premultiply(mr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const mr=new Fe;function Ql(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Ws(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function bu(){const i=Ws("canvas");return i.style.display="block",i}const ya={};function Fs(i){i in ya||(ya[i]=!0,console.warn(i))}function Tu(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}function Au(i){const e=i.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function wu(i){const e=i.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}const Ea=new Fe().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),ba=new Fe().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),Li={[Rn]:{transfer:ks,primaries:Hs,luminanceCoefficients:[.2126,.7152,.0722],toReference:i=>i,fromReference:i=>i},[qt]:{transfer:nt,primaries:Hs,luminanceCoefficients:[.2126,.7152,.0722],toReference:i=>i.convertSRGBToLinear(),fromReference:i=>i.convertLinearToSRGB()},[Qs]:{transfer:ks,primaries:Gs,luminanceCoefficients:[.2289,.6917,.0793],toReference:i=>i.applyMatrix3(ba),fromReference:i=>i.applyMatrix3(Ea)},[Jo]:{transfer:nt,primaries:Gs,luminanceCoefficients:[.2289,.6917,.0793],toReference:i=>i.convertSRGBToLinear().applyMatrix3(ba),fromReference:i=>i.applyMatrix3(Ea).convertLinearToSRGB()}},Ru=new Set([Rn,Qs]),Je={enabled:!0,_workingColorSpace:Rn,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(i){if(!Ru.has(i))throw new Error(`Unsupported working color space, "${i}".`);this._workingColorSpace=i},convert:function(i,e,t){if(this.enabled===!1||e===t||!e||!t)return i;const n=Li[e].toReference,s=Li[t].fromReference;return s(n(i))},fromWorkingColorSpace:function(i,e){return this.convert(i,this._workingColorSpace,e)},toWorkingColorSpace:function(i,e){return this.convert(i,e,this._workingColorSpace)},getPrimaries:function(i){return Li[i].primaries},getTransfer:function(i){return i===Sn?ks:Li[i].transfer},getLuminanceCoefficients:function(i,e=this._workingColorSpace){return i.fromArray(Li[e].luminanceCoefficients)}};function vi(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function _r(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let Qn;class Cu{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{Qn===void 0&&(Qn=Ws("canvas")),Qn.width=e.width,Qn.height=e.height;const n=Qn.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=Qn}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=Ws("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=vi(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(vi(t[n]/255)*255):t[n]=vi(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let Pu=0;class ec{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Pu++}),this.uuid=Xi(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(gr(s[o].image)):r.push(gr(s[o]))}else r=gr(s);n.url=r}return t||(e.images[this.uuid]=n),n}}function gr(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?Cu.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let Lu=0;class bt extends Xn{constructor(e=bt.DEFAULT_IMAGE,t=bt.DEFAULT_MAPPING,n=zn,s=zn,r=Gt,o=kn,a=Wt,l=cn,c=bt.DEFAULT_ANISOTROPY,u=Sn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Lu++}),this.uuid=Xi(),this.name="",this.source=new ec(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Le(0,0),this.repeat=new Le(1,1),this.center=new Le(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Fe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==kl)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case uo:e.x=e.x-Math.floor(e.x);break;case zn:e.x=e.x<0?0:1;break;case ho:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case uo:e.y=e.y-Math.floor(e.y);break;case zn:e.y=e.y<0?0:1;break;case ho:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}bt.DEFAULT_IMAGE=null;bt.DEFAULT_MAPPING=kl;bt.DEFAULT_ANISOTROPY=1;class rt{constructor(e=0,t=0,n=0,s=1){rt.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r;const l=e.elements,c=l[0],u=l[4],_=l[8],m=l[1],h=l[5],g=l[9],M=l[2],p=l[6],d=l[10];if(Math.abs(u-m)<.01&&Math.abs(_-M)<.01&&Math.abs(g-p)<.01){if(Math.abs(u+m)<.1&&Math.abs(_+M)<.1&&Math.abs(g+p)<.1&&Math.abs(c+h+d-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const y=(c+1)/2,w=(h+1)/2,B=(d+1)/2,I=(u+m)/4,P=(_+M)/4,F=(g+p)/4;return y>w&&y>B?y<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(y),s=I/n,r=P/n):w>B?w<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(w),n=I/s,r=F/s):B<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(B),n=P/r,s=F/r),this.set(n,s,r,t),this}let b=Math.sqrt((p-g)*(p-g)+(_-M)*(_-M)+(m-u)*(m-u));return Math.abs(b)<.001&&(b=1),this.x=(p-g)/b,this.y=(_-M)/b,this.z=(m-u)/b,this.w=Math.acos((c+h+d-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Du extends Xn{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new rt(0,0,e,t),this.scissorTest=!1,this.viewport=new rt(0,0,e,t);const s={width:e,height:t,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Gt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const r=new bt(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];const o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,s=e.textures.length;n<s;n++)this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0;const t=Object.assign({},e.texture.image);return this.texture.source=new ec(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Gn extends Du{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class tc extends bt{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Ut,this.minFilter=Ut,this.wrapR=zn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class Iu extends bt{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Ut,this.minFilter=Ut,this.wrapR=zn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Vn{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let l=n[s+0],c=n[s+1],u=n[s+2],_=n[s+3];const m=r[o+0],h=r[o+1],g=r[o+2],M=r[o+3];if(a===0){e[t+0]=l,e[t+1]=c,e[t+2]=u,e[t+3]=_;return}if(a===1){e[t+0]=m,e[t+1]=h,e[t+2]=g,e[t+3]=M;return}if(_!==M||l!==m||c!==h||u!==g){let p=1-a;const d=l*m+c*h+u*g+_*M,b=d>=0?1:-1,y=1-d*d;if(y>Number.EPSILON){const B=Math.sqrt(y),I=Math.atan2(B,d*b);p=Math.sin(p*I)/B,a=Math.sin(a*I)/B}const w=a*b;if(l=l*p+m*w,c=c*p+h*w,u=u*p+g*w,_=_*p+M*w,p===1-a){const B=1/Math.sqrt(l*l+c*c+u*u+_*_);l*=B,c*=B,u*=B,_*=B}}e[t]=l,e[t+1]=c,e[t+2]=u,e[t+3]=_}static multiplyQuaternionsFlat(e,t,n,s,r,o){const a=n[s],l=n[s+1],c=n[s+2],u=n[s+3],_=r[o],m=r[o+1],h=r[o+2],g=r[o+3];return e[t]=a*g+u*_+l*h-c*m,e[t+1]=l*g+u*m+c*_-a*h,e[t+2]=c*g+u*h+a*m-l*_,e[t+3]=u*g-a*_-l*m-c*h,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(n/2),u=a(s/2),_=a(r/2),m=l(n/2),h=l(s/2),g=l(r/2);switch(o){case"XYZ":this._x=m*u*_+c*h*g,this._y=c*h*_-m*u*g,this._z=c*u*g+m*h*_,this._w=c*u*_-m*h*g;break;case"YXZ":this._x=m*u*_+c*h*g,this._y=c*h*_-m*u*g,this._z=c*u*g-m*h*_,this._w=c*u*_+m*h*g;break;case"ZXY":this._x=m*u*_-c*h*g,this._y=c*h*_+m*u*g,this._z=c*u*g+m*h*_,this._w=c*u*_-m*h*g;break;case"ZYX":this._x=m*u*_-c*h*g,this._y=c*h*_+m*u*g,this._z=c*u*g-m*h*_,this._w=c*u*_+m*h*g;break;case"YZX":this._x=m*u*_+c*h*g,this._y=c*h*_+m*u*g,this._z=c*u*g-m*h*_,this._w=c*u*_-m*h*g;break;case"XZY":this._x=m*u*_-c*h*g,this._y=c*h*_-m*u*g,this._z=c*u*g+m*h*_,this._w=c*u*_+m*h*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],l=t[9],c=t[2],u=t[6],_=t[10],m=n+a+_;if(m>0){const h=.5/Math.sqrt(m+1);this._w=.25/h,this._x=(u-l)*h,this._y=(r-c)*h,this._z=(o-s)*h}else if(n>a&&n>_){const h=2*Math.sqrt(1+n-a-_);this._w=(u-l)/h,this._x=.25*h,this._y=(s+o)/h,this._z=(r+c)/h}else if(a>_){const h=2*Math.sqrt(1+a-n-_);this._w=(r-c)/h,this._x=(s+o)/h,this._y=.25*h,this._z=(l+u)/h}else{const h=2*Math.sqrt(1+_-n-a);this._w=(o-s)/h,this._x=(r+c)/h,this._y=(l+u)/h,this._z=.25*h}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Mt(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,l=t._y,c=t._z,u=t._w;return this._x=n*u+o*a+s*c-r*l,this._y=s*u+o*l+r*a-n*c,this._z=r*u+o*c+n*l-s*a,this._w=o*u-n*a-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,s=this._y,r=this._z,o=this._w;let a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;const l=1-a*a;if(l<=Number.EPSILON){const h=1-t;return this._w=h*o+t*this._w,this._x=h*n+t*this._x,this._y=h*s+t*this._y,this._z=h*r+t*this._z,this.normalize(),this}const c=Math.sqrt(l),u=Math.atan2(c,a),_=Math.sin((1-t)*u)/c,m=Math.sin(t*u)/c;return this._w=o*_+this._w*m,this._x=n*_+this._x*m,this._y=s*_+this._y*m,this._z=r*_+this._z*m,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class O{constructor(e=0,t=0,n=0){O.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Ta.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Ta.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){const t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*s-a*n),u=2*(a*t-r*s),_=2*(r*n-o*t);return this.x=t+l*c+o*_-a*u,this.y=n+l*u+a*c-r*_,this.z=s+l*_+r*u-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,l=t.z;return this.x=s*l-r*a,this.y=r*o-n*l,this.z=n*a-s*o,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return vr.copy(this).projectOnVector(e),this.sub(vr)}reflect(e){return this.sub(vr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Mt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const vr=new O,Ta=new Vn;class Yi{constructor(e=new O(1/0,1/0,1/0),t=new O(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(zt.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(zt.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=zt.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,zt):zt.fromBufferAttribute(r,o),zt.applyMatrix4(e.matrixWorld),this.expandByPoint(zt);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),ss.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),ss.copy(n.boundingBox)),ss.applyMatrix4(e.matrixWorld),this.union(ss)}const s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,zt),zt.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Di),rs.subVectors(this.max,Di),ei.subVectors(e.a,Di),ti.subVectors(e.b,Di),ni.subVectors(e.c,Di),fn.subVectors(ti,ei),pn.subVectors(ni,ti),Cn.subVectors(ei,ni);let t=[0,-fn.z,fn.y,0,-pn.z,pn.y,0,-Cn.z,Cn.y,fn.z,0,-fn.x,pn.z,0,-pn.x,Cn.z,0,-Cn.x,-fn.y,fn.x,0,-pn.y,pn.x,0,-Cn.y,Cn.x,0];return!xr(t,ei,ti,ni,rs)||(t=[1,0,0,0,1,0,0,0,1],!xr(t,ei,ti,ni,rs))?!1:(os.crossVectors(fn,pn),t=[os.x,os.y,os.z],xr(t,ei,ti,ni,rs))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,zt).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(zt).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Jt[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Jt[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Jt[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Jt[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Jt[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Jt[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Jt[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Jt[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Jt),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const Jt=[new O,new O,new O,new O,new O,new O,new O,new O],zt=new O,ss=new Yi,ei=new O,ti=new O,ni=new O,fn=new O,pn=new O,Cn=new O,Di=new O,rs=new O,os=new O,Pn=new O;function xr(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){Pn.fromArray(i,r);const a=s.x*Math.abs(Pn.x)+s.y*Math.abs(Pn.y)+s.z*Math.abs(Pn.z),l=e.dot(Pn),c=t.dot(Pn),u=n.dot(Pn);if(Math.max(-Math.max(l,c,u),Math.min(l,c,u))>a)return!1}return!0}const Nu=new Yi,Ii=new O,Mr=new O;class er{constructor(e=new O,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Nu.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ii.subVectors(e,this.center);const t=Ii.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Ii,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Mr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ii.copy(e.center).add(Mr)),this.expandByPoint(Ii.copy(e.center).sub(Mr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const Qt=new O,Sr=new O,as=new O,mn=new O,yr=new O,ls=new O,Er=new O;class tr{constructor(e=new O,t=new O(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Qt)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=Qt.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Qt.copy(this.origin).addScaledVector(this.direction,t),Qt.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){Sr.copy(e).add(t).multiplyScalar(.5),as.copy(t).sub(e).normalize(),mn.copy(this.origin).sub(Sr);const r=e.distanceTo(t)*.5,o=-this.direction.dot(as),a=mn.dot(this.direction),l=-mn.dot(as),c=mn.lengthSq(),u=Math.abs(1-o*o);let _,m,h,g;if(u>0)if(_=o*l-a,m=o*a-l,g=r*u,_>=0)if(m>=-g)if(m<=g){const M=1/u;_*=M,m*=M,h=_*(_+o*m+2*a)+m*(o*_+m+2*l)+c}else m=r,_=Math.max(0,-(o*m+a)),h=-_*_+m*(m+2*l)+c;else m=-r,_=Math.max(0,-(o*m+a)),h=-_*_+m*(m+2*l)+c;else m<=-g?(_=Math.max(0,-(-o*r+a)),m=_>0?-r:Math.min(Math.max(-r,-l),r),h=-_*_+m*(m+2*l)+c):m<=g?(_=0,m=Math.min(Math.max(-r,-l),r),h=m*(m+2*l)+c):(_=Math.max(0,-(o*r+a)),m=_>0?r:Math.min(Math.max(-r,-l),r),h=-_*_+m*(m+2*l)+c);else m=o>0?-r:r,_=Math.max(0,-(o*m+a)),h=-_*_+m*(m+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,_),s&&s.copy(Sr).addScaledVector(as,m),h}intersectSphere(e,t){Qt.subVectors(e.center,this.origin);const n=Qt.dot(this.direction),s=Qt.dot(Qt)-n*n,r=e.radius*e.radius;if(s>r)return null;const o=Math.sqrt(r-s),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,l;const c=1/this.direction.x,u=1/this.direction.y,_=1/this.direction.z,m=this.origin;return c>=0?(n=(e.min.x-m.x)*c,s=(e.max.x-m.x)*c):(n=(e.max.x-m.x)*c,s=(e.min.x-m.x)*c),u>=0?(r=(e.min.y-m.y)*u,o=(e.max.y-m.y)*u):(r=(e.max.y-m.y)*u,o=(e.min.y-m.y)*u),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),_>=0?(a=(e.min.z-m.z)*_,l=(e.max.z-m.z)*_):(a=(e.max.z-m.z)*_,l=(e.min.z-m.z)*_),n>l||a>s)||((a>n||n!==n)&&(n=a),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,Qt)!==null}intersectTriangle(e,t,n,s,r){yr.subVectors(t,e),ls.subVectors(n,e),Er.crossVectors(yr,ls);let o=this.direction.dot(Er),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;mn.subVectors(this.origin,e);const l=a*this.direction.dot(ls.crossVectors(mn,ls));if(l<0)return null;const c=a*this.direction.dot(yr.cross(mn));if(c<0||l+c>o)return null;const u=-a*mn.dot(Er);return u<0?null:this.at(u/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class tt{constructor(e,t,n,s,r,o,a,l,c,u,_,m,h,g,M,p){tt.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c,u,_,m,h,g,M,p)}set(e,t,n,s,r,o,a,l,c,u,_,m,h,g,M,p){const d=this.elements;return d[0]=e,d[4]=t,d[8]=n,d[12]=s,d[1]=r,d[5]=o,d[9]=a,d[13]=l,d[2]=c,d[6]=u,d[10]=_,d[14]=m,d[3]=h,d[7]=g,d[11]=M,d[15]=p,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new tt().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,s=1/ii.setFromMatrixColumn(e,0).length(),r=1/ii.setFromMatrixColumn(e,1).length(),o=1/ii.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(s),c=Math.sin(s),u=Math.cos(r),_=Math.sin(r);if(e.order==="XYZ"){const m=o*u,h=o*_,g=a*u,M=a*_;t[0]=l*u,t[4]=-l*_,t[8]=c,t[1]=h+g*c,t[5]=m-M*c,t[9]=-a*l,t[2]=M-m*c,t[6]=g+h*c,t[10]=o*l}else if(e.order==="YXZ"){const m=l*u,h=l*_,g=c*u,M=c*_;t[0]=m+M*a,t[4]=g*a-h,t[8]=o*c,t[1]=o*_,t[5]=o*u,t[9]=-a,t[2]=h*a-g,t[6]=M+m*a,t[10]=o*l}else if(e.order==="ZXY"){const m=l*u,h=l*_,g=c*u,M=c*_;t[0]=m-M*a,t[4]=-o*_,t[8]=g+h*a,t[1]=h+g*a,t[5]=o*u,t[9]=M-m*a,t[2]=-o*c,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){const m=o*u,h=o*_,g=a*u,M=a*_;t[0]=l*u,t[4]=g*c-h,t[8]=m*c+M,t[1]=l*_,t[5]=M*c+m,t[9]=h*c-g,t[2]=-c,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){const m=o*l,h=o*c,g=a*l,M=a*c;t[0]=l*u,t[4]=M-m*_,t[8]=g*_+h,t[1]=_,t[5]=o*u,t[9]=-a*u,t[2]=-c*u,t[6]=h*_+g,t[10]=m-M*_}else if(e.order==="XZY"){const m=o*l,h=o*c,g=a*l,M=a*c;t[0]=l*u,t[4]=-_,t[8]=c*u,t[1]=m*_+M,t[5]=o*u,t[9]=h*_-g,t[2]=g*_-h,t[6]=a*u,t[10]=M*_+m}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Uu,e,Fu)}lookAt(e,t,n){const s=this.elements;return wt.subVectors(e,t),wt.lengthSq()===0&&(wt.z=1),wt.normalize(),_n.crossVectors(n,wt),_n.lengthSq()===0&&(Math.abs(n.z)===1?wt.x+=1e-4:wt.z+=1e-4,wt.normalize(),_n.crossVectors(n,wt)),_n.normalize(),cs.crossVectors(wt,_n),s[0]=_n.x,s[4]=cs.x,s[8]=wt.x,s[1]=_n.y,s[5]=cs.y,s[9]=wt.y,s[2]=_n.z,s[6]=cs.z,s[10]=wt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],u=n[1],_=n[5],m=n[9],h=n[13],g=n[2],M=n[6],p=n[10],d=n[14],b=n[3],y=n[7],w=n[11],B=n[15],I=s[0],P=s[4],F=s[8],te=s[12],v=s[1],E=s[5],W=s[9],V=s[13],Z=s[2],ie=s[6],X=s[10],ne=s[14],G=s[3],_e=s[7],ve=s[11],ye=s[15];return r[0]=o*I+a*v+l*Z+c*G,r[4]=o*P+a*E+l*ie+c*_e,r[8]=o*F+a*W+l*X+c*ve,r[12]=o*te+a*V+l*ne+c*ye,r[1]=u*I+_*v+m*Z+h*G,r[5]=u*P+_*E+m*ie+h*_e,r[9]=u*F+_*W+m*X+h*ve,r[13]=u*te+_*V+m*ne+h*ye,r[2]=g*I+M*v+p*Z+d*G,r[6]=g*P+M*E+p*ie+d*_e,r[10]=g*F+M*W+p*X+d*ve,r[14]=g*te+M*V+p*ne+d*ye,r[3]=b*I+y*v+w*Z+B*G,r[7]=b*P+y*E+w*ie+B*_e,r[11]=b*F+y*W+w*X+B*ve,r[15]=b*te+y*V+w*ne+B*ye,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],l=e[9],c=e[13],u=e[2],_=e[6],m=e[10],h=e[14],g=e[3],M=e[7],p=e[11],d=e[15];return g*(+r*l*_-s*c*_-r*a*m+n*c*m+s*a*h-n*l*h)+M*(+t*l*h-t*c*m+r*o*m-s*o*h+s*c*u-r*l*u)+p*(+t*c*_-t*a*h-r*o*_+n*o*h+r*a*u-n*c*u)+d*(-s*a*u-t*l*_+t*a*m+s*o*_-n*o*m+n*l*u)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8],_=e[9],m=e[10],h=e[11],g=e[12],M=e[13],p=e[14],d=e[15],b=_*p*c-M*m*c+M*l*h-a*p*h-_*l*d+a*m*d,y=g*m*c-u*p*c-g*l*h+o*p*h+u*l*d-o*m*d,w=u*M*c-g*_*c+g*a*h-o*M*h-u*a*d+o*_*d,B=g*_*l-u*M*l-g*a*m+o*M*m+u*a*p-o*_*p,I=t*b+n*y+s*w+r*B;if(I===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const P=1/I;return e[0]=b*P,e[1]=(M*m*r-_*p*r-M*s*h+n*p*h+_*s*d-n*m*d)*P,e[2]=(a*p*r-M*l*r+M*s*c-n*p*c-a*s*d+n*l*d)*P,e[3]=(_*l*r-a*m*r-_*s*c+n*m*c+a*s*h-n*l*h)*P,e[4]=y*P,e[5]=(u*p*r-g*m*r+g*s*h-t*p*h-u*s*d+t*m*d)*P,e[6]=(g*l*r-o*p*r-g*s*c+t*p*c+o*s*d-t*l*d)*P,e[7]=(o*m*r-u*l*r+u*s*c-t*m*c-o*s*h+t*l*h)*P,e[8]=w*P,e[9]=(g*_*r-u*M*r-g*n*h+t*M*h+u*n*d-t*_*d)*P,e[10]=(o*M*r-g*a*r+g*n*c-t*M*c-o*n*d+t*a*d)*P,e[11]=(u*a*r-o*_*r-u*n*c+t*_*c+o*n*h-t*a*h)*P,e[12]=B*P,e[13]=(u*M*s-g*_*s+g*n*m-t*M*m-u*n*p+t*_*p)*P,e[14]=(g*a*s-o*M*s-g*n*l+t*M*l+o*n*p-t*a*p)*P,e[15]=(o*_*s-u*a*s+u*n*l-t*_*l-o*n*m+t*a*m)*P,this}scale(e){const t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,l=e.z,c=r*o,u=r*a;return this.set(c*o+n,c*a-s*l,c*l+s*a,0,c*a+s*l,u*a+n,u*l-s*o,0,c*l-s*a,u*l+s*o,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){const s=this.elements,r=t._x,o=t._y,a=t._z,l=t._w,c=r+r,u=o+o,_=a+a,m=r*c,h=r*u,g=r*_,M=o*u,p=o*_,d=a*_,b=l*c,y=l*u,w=l*_,B=n.x,I=n.y,P=n.z;return s[0]=(1-(M+d))*B,s[1]=(h+w)*B,s[2]=(g-y)*B,s[3]=0,s[4]=(h-w)*I,s[5]=(1-(m+d))*I,s[6]=(p+b)*I,s[7]=0,s[8]=(g+y)*P,s[9]=(p-b)*P,s[10]=(1-(m+M))*P,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){const s=this.elements;let r=ii.set(s[0],s[1],s[2]).length();const o=ii.set(s[4],s[5],s[6]).length(),a=ii.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],kt.copy(this);const c=1/r,u=1/o,_=1/a;return kt.elements[0]*=c,kt.elements[1]*=c,kt.elements[2]*=c,kt.elements[4]*=u,kt.elements[5]*=u,kt.elements[6]*=u,kt.elements[8]*=_,kt.elements[9]*=_,kt.elements[10]*=_,t.setFromRotationMatrix(kt),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=an){const l=this.elements,c=2*r/(t-e),u=2*r/(n-s),_=(t+e)/(t-e),m=(n+s)/(n-s);let h,g;if(a===an)h=-(o+r)/(o-r),g=-2*o*r/(o-r);else if(a===Vs)h=-o/(o-r),g=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=c,l[4]=0,l[8]=_,l[12]=0,l[1]=0,l[5]=u,l[9]=m,l[13]=0,l[2]=0,l[6]=0,l[10]=h,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=an){const l=this.elements,c=1/(t-e),u=1/(n-s),_=1/(o-r),m=(t+e)*c,h=(n+s)*u;let g,M;if(a===an)g=(o+r)*_,M=-2*_;else if(a===Vs)g=r*_,M=-1*_;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-m,l[1]=0,l[5]=2*u,l[9]=0,l[13]=-h,l[2]=0,l[6]=0,l[10]=M,l[14]=-g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const ii=new O,kt=new tt,Uu=new O(0,0,0),Fu=new O(1,1,1),_n=new O,cs=new O,wt=new O,Aa=new tt,wa=new Vn;class Zt{constructor(e=0,t=0,n=0,s=Zt.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const s=e.elements,r=s[0],o=s[4],a=s[8],l=s[1],c=s[5],u=s[9],_=s[2],m=s[6],h=s[10];switch(t){case"XYZ":this._y=Math.asin(Mt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-u,h),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(m,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Mt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(a,h),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-_,r),this._z=0);break;case"ZXY":this._x=Math.asin(Mt(m,-1,1)),Math.abs(m)<.9999999?(this._y=Math.atan2(-_,h),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Mt(_,-1,1)),Math.abs(_)<.9999999?(this._x=Math.atan2(m,h),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Mt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-u,c),this._y=Math.atan2(-_,r)):(this._x=0,this._y=Math.atan2(a,h));break;case"XZY":this._z=Math.asin(-Mt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(m,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-u,h),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Aa.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Aa,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return wa.setFromEuler(this),this.setFromQuaternion(wa,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Zt.DEFAULT_ORDER="XYZ";class Qo{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let Ou=0;const Ra=new O,si=new Vn,en=new tt,us=new O,Ni=new O,Bu=new O,zu=new Vn,Ca=new O(1,0,0),Pa=new O(0,1,0),La=new O(0,0,1),Da={type:"added"},ku={type:"removed"},ri={type:"childadded",child:null},br={type:"childremoved",child:null};class ft extends Xn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Ou++}),this.uuid=Xi(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=ft.DEFAULT_UP.clone();const e=new O,t=new Zt,n=new Vn,s=new O(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new tt},normalMatrix:{value:new Fe}}),this.matrix=new tt,this.matrixWorld=new tt,this.matrixAutoUpdate=ft.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=ft.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Qo,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return si.setFromAxisAngle(e,t),this.quaternion.multiply(si),this}rotateOnWorldAxis(e,t){return si.setFromAxisAngle(e,t),this.quaternion.premultiply(si),this}rotateX(e){return this.rotateOnAxis(Ca,e)}rotateY(e){return this.rotateOnAxis(Pa,e)}rotateZ(e){return this.rotateOnAxis(La,e)}translateOnAxis(e,t){return Ra.copy(e).applyQuaternion(this.quaternion),this.position.add(Ra.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Ca,e)}translateY(e){return this.translateOnAxis(Pa,e)}translateZ(e){return this.translateOnAxis(La,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(en.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?us.copy(e):us.set(e,t,n);const s=this.parent;this.updateWorldMatrix(!0,!1),Ni.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?en.lookAt(Ni,us,this.up):en.lookAt(us,Ni,this.up),this.quaternion.setFromRotationMatrix(en),s&&(en.extractRotation(s.matrixWorld),si.setFromRotationMatrix(en),this.quaternion.premultiply(si.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Da),ri.child=e,this.dispatchEvent(ri),ri.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(ku),br.child=e,this.dispatchEvent(br),br.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),en.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),en.multiply(e.parent.matrixWorld)),e.applyMatrix4(en),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Da),ri.child=e,this.dispatchEvent(ri),ri.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){const o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ni,e,Bu),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ni,zu,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const l=a.shapes;if(Array.isArray(l))for(let c=0,u=l.length;c<u;c++){const _=l[c];r(e.shapes,_)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(e.materials,this.material[l]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){const l=this.animations[a];s.animations.push(r(e.animations,l))}}if(t){const a=o(e.geometries),l=o(e.materials),c=o(e.textures),u=o(e.images),_=o(e.shapes),m=o(e.skeletons),h=o(e.animations),g=o(e.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),u.length>0&&(n.images=u),_.length>0&&(n.shapes=_),m.length>0&&(n.skeletons=m),h.length>0&&(n.animations=h),g.length>0&&(n.nodes=g)}return n.object=s,n;function o(a){const l=[];for(const c in a){const u=a[c];delete u.metadata,l.push(u)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const s=e.children[n];this.add(s.clone())}return this}}ft.DEFAULT_UP=new O(0,1,0);ft.DEFAULT_MATRIX_AUTO_UPDATE=!0;ft.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Ht=new O,tn=new O,Tr=new O,nn=new O,oi=new O,ai=new O,Ia=new O,Ar=new O,wr=new O,Rr=new O,Cr=new rt,Pr=new rt,Lr=new rt;class Vt{constructor(e=new O,t=new O,n=new O){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),Ht.subVectors(e,t),s.cross(Ht);const r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){Ht.subVectors(s,t),tn.subVectors(n,t),Tr.subVectors(e,t);const o=Ht.dot(Ht),a=Ht.dot(tn),l=Ht.dot(Tr),c=tn.dot(tn),u=tn.dot(Tr),_=o*c-a*a;if(_===0)return r.set(0,0,0),null;const m=1/_,h=(c*l-a*u)*m,g=(o*u-a*l)*m;return r.set(1-h-g,g,h)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,nn)===null?!1:nn.x>=0&&nn.y>=0&&nn.x+nn.y<=1}static getInterpolation(e,t,n,s,r,o,a,l){return this.getBarycoord(e,t,n,s,nn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,nn.x),l.addScaledVector(o,nn.y),l.addScaledVector(a,nn.z),l)}static getInterpolatedAttribute(e,t,n,s,r,o){return Cr.setScalar(0),Pr.setScalar(0),Lr.setScalar(0),Cr.fromBufferAttribute(e,t),Pr.fromBufferAttribute(e,n),Lr.fromBufferAttribute(e,s),o.setScalar(0),o.addScaledVector(Cr,r.x),o.addScaledVector(Pr,r.y),o.addScaledVector(Lr,r.z),o}static isFrontFacing(e,t,n,s){return Ht.subVectors(n,t),tn.subVectors(e,t),Ht.cross(tn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Ht.subVectors(this.c,this.b),tn.subVectors(this.a,this.b),Ht.cross(tn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return Vt.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return Vt.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return Vt.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return Vt.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return Vt.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,s=this.b,r=this.c;let o,a;oi.subVectors(s,n),ai.subVectors(r,n),Ar.subVectors(e,n);const l=oi.dot(Ar),c=ai.dot(Ar);if(l<=0&&c<=0)return t.copy(n);wr.subVectors(e,s);const u=oi.dot(wr),_=ai.dot(wr);if(u>=0&&_<=u)return t.copy(s);const m=l*_-u*c;if(m<=0&&l>=0&&u<=0)return o=l/(l-u),t.copy(n).addScaledVector(oi,o);Rr.subVectors(e,r);const h=oi.dot(Rr),g=ai.dot(Rr);if(g>=0&&h<=g)return t.copy(r);const M=h*c-l*g;if(M<=0&&c>=0&&g<=0)return a=c/(c-g),t.copy(n).addScaledVector(ai,a);const p=u*g-h*_;if(p<=0&&_-u>=0&&h-g>=0)return Ia.subVectors(r,s),a=(_-u)/(_-u+(h-g)),t.copy(s).addScaledVector(Ia,a);const d=1/(p+M+m);return o=M*d,a=m*d,t.copy(n).addScaledVector(oi,o).addScaledVector(ai,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const nc={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},gn={h:0,s:0,l:0},hs={h:0,s:0,l:0};function Dr(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}class We{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=qt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Je.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=Je.workingColorSpace){return this.r=e,this.g=t,this.b=n,Je.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=Je.workingColorSpace){if(e=yu(e,1),t=Mt(t,0,1),n=Mt(n,0,1),t===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=Dr(o,r,e+1/3),this.g=Dr(o,r,e),this.b=Dr(o,r,e-1/3)}return Je.toWorkingColorSpace(this,s),this}setStyle(e,t=qt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r;const o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){const r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=qt){const n=nc[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=vi(e.r),this.g=vi(e.g),this.b=vi(e.b),this}copyLinearToSRGB(e){return this.r=_r(e.r),this.g=_r(e.g),this.b=_r(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=qt){return Je.fromWorkingColorSpace(vt.copy(this),e),Math.round(Mt(vt.r*255,0,255))*65536+Math.round(Mt(vt.g*255,0,255))*256+Math.round(Mt(vt.b*255,0,255))}getHexString(e=qt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Je.workingColorSpace){Je.fromWorkingColorSpace(vt.copy(this),t);const n=vt.r,s=vt.g,r=vt.b,o=Math.max(n,s,r),a=Math.min(n,s,r);let l,c;const u=(a+o)/2;if(a===o)l=0,c=0;else{const _=o-a;switch(c=u<=.5?_/(o+a):_/(2-o-a),o){case n:l=(s-r)/_+(s<r?6:0);break;case s:l=(r-n)/_+2;break;case r:l=(n-s)/_+4;break}l/=6}return e.h=l,e.s=c,e.l=u,e}getRGB(e,t=Je.workingColorSpace){return Je.fromWorkingColorSpace(vt.copy(this),t),e.r=vt.r,e.g=vt.g,e.b=vt.b,e}getStyle(e=qt){Je.fromWorkingColorSpace(vt.copy(this),e);const t=vt.r,n=vt.g,s=vt.b;return e!==qt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(gn),this.setHSL(gn.h+e,gn.s+t,gn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(gn),e.getHSL(hs);const n=pr(gn.h,hs.h,t),s=pr(gn.s,hs.s,t),r=pr(gn.l,hs.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const vt=new We;We.NAMES=nc;let Hu=0;class Yn extends Xn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Hu++}),this.uuid=Xi(),this.name="",this.type="Material",this.blending=_i,this.side=An,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Qr,this.blendDst=eo,this.blendEquation=On,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new We(0,0,0),this.blendAlpha=0,this.depthFunc=Si,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=xa,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Jn,this.stencilZFail=Jn,this.stencilZPass=Jn,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==_i&&(n.blending=this.blending),this.side!==An&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Qr&&(n.blendSrc=this.blendSrc),this.blendDst!==eo&&(n.blendDst=this.blendDst),this.blendEquation!==On&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Si&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==xa&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Jn&&(n.stencilFail=this.stencilFail),this.stencilZFail!==Jn&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==Jn&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){const o=[];for(const a in r){const l=r[a];delete l.metadata,o.push(l)}return o}if(t){const r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class ea extends Yn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new We(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Zt,this.combine=zl,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const lt=new O,ds=new Le;class $t{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Ma,this.updateRanges=[],this.gpuType=on,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)ds.fromBufferAttribute(this,t),ds.applyMatrix3(e),this.setXY(t,ds.x,ds.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.applyMatrix3(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.applyMatrix4(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.applyNormalMatrix(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.transformDirection(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Pi(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=St(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Pi(t,this.array)),t}setX(e,t){return this.normalized&&(t=St(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Pi(t,this.array)),t}setY(e,t){return this.normalized&&(t=St(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Pi(t,this.array)),t}setZ(e,t){return this.normalized&&(t=St(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Pi(t,this.array)),t}setW(e,t){return this.normalized&&(t=St(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=St(t,this.array),n=St(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=St(t,this.array),n=St(n,this.array),s=St(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=St(t,this.array),n=St(n,this.array),s=St(s,this.array),r=St(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Ma&&(e.usage=this.usage),e}}class ic extends $t{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class sc extends $t{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class Tt extends $t{constructor(e,t,n){super(new Float32Array(e),t,n)}}let Gu=0;const It=new tt,Ir=new ft,li=new O,Rt=new Yi,Ui=new Yi,dt=new O;class Pt extends Xn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Gu++}),this.uuid=Xi(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Ql(e)?sc:ic)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Fe().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}const s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return It.makeRotationFromQuaternion(e),this.applyMatrix4(It),this}rotateX(e){return It.makeRotationX(e),this.applyMatrix4(It),this}rotateY(e){return It.makeRotationY(e),this.applyMatrix4(It),this}rotateZ(e){return It.makeRotationZ(e),this.applyMatrix4(It),this}translate(e,t,n){return It.makeTranslation(e,t,n),this.applyMatrix4(It),this}scale(e,t,n){return It.makeScale(e,t,n),this.applyMatrix4(It),this}lookAt(e){return Ir.lookAt(e),Ir.updateMatrix(),this.applyMatrix4(Ir.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(li).negate(),this.translate(li.x,li.y,li.z),this}setFromPoints(e){const t=[];for(let n=0,s=e.length;n<s;n++){const r=e[n];t.push(r.x,r.y,r.z||0)}return this.setAttribute("position",new Tt(t,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Yi);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new O(-1/0,-1/0,-1/0),new O(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){const r=t[n];Rt.setFromBufferAttribute(r),this.morphTargetsRelative?(dt.addVectors(this.boundingBox.min,Rt.min),this.boundingBox.expandByPoint(dt),dt.addVectors(this.boundingBox.max,Rt.max),this.boundingBox.expandByPoint(dt)):(this.boundingBox.expandByPoint(Rt.min),this.boundingBox.expandByPoint(Rt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new er);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new O,1/0);return}if(e){const n=this.boundingSphere.center;if(Rt.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){const a=t[r];Ui.setFromBufferAttribute(a),this.morphTargetsRelative?(dt.addVectors(Rt.min,Ui.min),Rt.expandByPoint(dt),dt.addVectors(Rt.max,Ui.max),Rt.expandByPoint(dt)):(Rt.expandByPoint(Ui.min),Rt.expandByPoint(Ui.max))}Rt.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)dt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(dt));if(t)for(let r=0,o=t.length;r<o;r++){const a=t[r],l=this.morphTargetsRelative;for(let c=0,u=a.count;c<u;c++)dt.fromBufferAttribute(a,c),l&&(li.fromBufferAttribute(e,c),dt.add(li)),s=Math.max(s,n.distanceToSquared(dt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=t.position,s=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new $t(new Float32Array(4*n.count),4));const o=this.getAttribute("tangent"),a=[],l=[];for(let F=0;F<n.count;F++)a[F]=new O,l[F]=new O;const c=new O,u=new O,_=new O,m=new Le,h=new Le,g=new Le,M=new O,p=new O;function d(F,te,v){c.fromBufferAttribute(n,F),u.fromBufferAttribute(n,te),_.fromBufferAttribute(n,v),m.fromBufferAttribute(r,F),h.fromBufferAttribute(r,te),g.fromBufferAttribute(r,v),u.sub(c),_.sub(c),h.sub(m),g.sub(m);const E=1/(h.x*g.y-g.x*h.y);isFinite(E)&&(M.copy(u).multiplyScalar(g.y).addScaledVector(_,-h.y).multiplyScalar(E),p.copy(_).multiplyScalar(h.x).addScaledVector(u,-g.x).multiplyScalar(E),a[F].add(M),a[te].add(M),a[v].add(M),l[F].add(p),l[te].add(p),l[v].add(p))}let b=this.groups;b.length===0&&(b=[{start:0,count:e.count}]);for(let F=0,te=b.length;F<te;++F){const v=b[F],E=v.start,W=v.count;for(let V=E,Z=E+W;V<Z;V+=3)d(e.getX(V+0),e.getX(V+1),e.getX(V+2))}const y=new O,w=new O,B=new O,I=new O;function P(F){B.fromBufferAttribute(s,F),I.copy(B);const te=a[F];y.copy(te),y.sub(B.multiplyScalar(B.dot(te))).normalize(),w.crossVectors(I,te);const E=w.dot(l[F])<0?-1:1;o.setXYZW(F,y.x,y.y,y.z,E)}for(let F=0,te=b.length;F<te;++F){const v=b[F],E=v.start,W=v.count;for(let V=E,Z=E+W;V<Z;V+=3)P(e.getX(V+0)),P(e.getX(V+1)),P(e.getX(V+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new $t(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let m=0,h=n.count;m<h;m++)n.setXYZ(m,0,0,0);const s=new O,r=new O,o=new O,a=new O,l=new O,c=new O,u=new O,_=new O;if(e)for(let m=0,h=e.count;m<h;m+=3){const g=e.getX(m+0),M=e.getX(m+1),p=e.getX(m+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,M),o.fromBufferAttribute(t,p),u.subVectors(o,r),_.subVectors(s,r),u.cross(_),a.fromBufferAttribute(n,g),l.fromBufferAttribute(n,M),c.fromBufferAttribute(n,p),a.add(u),l.add(u),c.add(u),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(M,l.x,l.y,l.z),n.setXYZ(p,c.x,c.y,c.z)}else for(let m=0,h=t.count;m<h;m+=3)s.fromBufferAttribute(t,m+0),r.fromBufferAttribute(t,m+1),o.fromBufferAttribute(t,m+2),u.subVectors(o,r),_.subVectors(s,r),u.cross(_),n.setXYZ(m+0,u.x,u.y,u.z),n.setXYZ(m+1,u.x,u.y,u.z),n.setXYZ(m+2,u.x,u.y,u.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)dt.fromBufferAttribute(e,t),dt.normalize(),e.setXYZ(t,dt.x,dt.y,dt.z)}toNonIndexed(){function e(a,l){const c=a.array,u=a.itemSize,_=a.normalized,m=new c.constructor(l.length*u);let h=0,g=0;for(let M=0,p=l.length;M<p;M++){a.isInterleavedBufferAttribute?h=l[M]*a.data.stride+a.offset:h=l[M]*u;for(let d=0;d<u;d++)m[g++]=c[h++]}return new $t(m,u,_)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new Pt,n=this.index.array,s=this.attributes;for(const a in s){const l=s[a],c=e(l,n);t.setAttribute(a,c)}const r=this.morphAttributes;for(const a in r){const l=[],c=r[a];for(let u=0,_=c.length;u<_;u++){const m=c[u],h=e(m,n);l.push(h)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,l=o.length;a<l;a++){const c=o[a];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const l in n){const c=n[l];e.data.attributes[l]=c.toJSON(e.data)}const s={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],u=[];for(let _=0,m=c.length;_<m;_++){const h=c[_];u.push(h.toJSON(e.data))}u.length>0&&(s[l]=u,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone(t));const s=e.attributes;for(const c in s){const u=s[c];this.setAttribute(c,u.clone(t))}const r=e.morphAttributes;for(const c in r){const u=[],_=r[c];for(let m=0,h=_.length;m<h;m++)u.push(_[m].clone(t));this.morphAttributes[c]=u}this.morphTargetsRelative=e.morphTargetsRelative;const o=e.groups;for(let c=0,u=o.length;c<u;c++){const _=o[c];this.addGroup(_.start,_.count,_.materialIndex)}const a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());const l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Na=new tt,Ln=new tr,fs=new er,Ua=new O,ps=new O,ms=new O,_s=new O,Nr=new O,gs=new O,Fa=new O,vs=new O;class Ft extends ft{constructor(e=new Pt,t=new ea){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){const n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);const a=this.morphTargetInfluences;if(r&&a){gs.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const u=a[l],_=r[l];u!==0&&(Nr.fromBufferAttribute(_,e),o?gs.addScaledVector(Nr,u):gs.addScaledVector(Nr.sub(t),u))}t.add(gs)}return t}raycast(e,t){const n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),fs.copy(n.boundingSphere),fs.applyMatrix4(r),Ln.copy(e.ray).recast(e.near),!(fs.containsPoint(Ln.origin)===!1&&(Ln.intersectSphere(fs,Ua)===null||Ln.origin.distanceToSquared(Ua)>(e.far-e.near)**2))&&(Na.copy(r).invert(),Ln.copy(e.ray).applyMatrix4(Na),!(n.boundingBox!==null&&Ln.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Ln)))}_computeIntersections(e,t,n){let s;const r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,u=r.attributes.uv1,_=r.attributes.normal,m=r.groups,h=r.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,M=m.length;g<M;g++){const p=m[g],d=o[p.materialIndex],b=Math.max(p.start,h.start),y=Math.min(a.count,Math.min(p.start+p.count,h.start+h.count));for(let w=b,B=y;w<B;w+=3){const I=a.getX(w),P=a.getX(w+1),F=a.getX(w+2);s=xs(this,d,e,n,c,u,_,I,P,F),s&&(s.faceIndex=Math.floor(w/3),s.face.materialIndex=p.materialIndex,t.push(s))}}else{const g=Math.max(0,h.start),M=Math.min(a.count,h.start+h.count);for(let p=g,d=M;p<d;p+=3){const b=a.getX(p),y=a.getX(p+1),w=a.getX(p+2);s=xs(this,o,e,n,c,u,_,b,y,w),s&&(s.faceIndex=Math.floor(p/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(o))for(let g=0,M=m.length;g<M;g++){const p=m[g],d=o[p.materialIndex],b=Math.max(p.start,h.start),y=Math.min(l.count,Math.min(p.start+p.count,h.start+h.count));for(let w=b,B=y;w<B;w+=3){const I=w,P=w+1,F=w+2;s=xs(this,d,e,n,c,u,_,I,P,F),s&&(s.faceIndex=Math.floor(w/3),s.face.materialIndex=p.materialIndex,t.push(s))}}else{const g=Math.max(0,h.start),M=Math.min(l.count,h.start+h.count);for(let p=g,d=M;p<d;p+=3){const b=p,y=p+1,w=p+2;s=xs(this,o,e,n,c,u,_,b,y,w),s&&(s.faceIndex=Math.floor(p/3),t.push(s))}}}}function Vu(i,e,t,n,s,r,o,a){let l;if(e.side===Et?l=n.intersectTriangle(o,r,s,!0,a):l=n.intersectTriangle(s,r,o,e.side===An,a),l===null)return null;vs.copy(a),vs.applyMatrix4(i.matrixWorld);const c=t.ray.origin.distanceTo(vs);return c<t.near||c>t.far?null:{distance:c,point:vs.clone(),object:i}}function xs(i,e,t,n,s,r,o,a,l,c){i.getVertexPosition(a,ps),i.getVertexPosition(l,ms),i.getVertexPosition(c,_s);const u=Vu(i,e,t,n,ps,ms,_s,Fa);if(u){const _=new O;Vt.getBarycoord(Fa,ps,ms,_s,_),s&&(u.uv=Vt.getInterpolatedAttribute(s,a,l,c,_,new Le)),r&&(u.uv1=Vt.getInterpolatedAttribute(r,a,l,c,_,new Le)),o&&(u.normal=Vt.getInterpolatedAttribute(o,a,l,c,_,new O),u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1));const m={a,b:l,c,normal:new O,materialIndex:0};Vt.getNormal(ps,ms,_s,m.normal),u.face=m,u.barycoord=_}return u}class qi extends Pt{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};const a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);const l=[],c=[],u=[],_=[];let m=0,h=0;g("z","y","x",-1,-1,n,t,e,o,r,0),g("z","y","x",1,-1,n,t,-e,o,r,1),g("x","z","y",1,1,e,n,t,s,o,2),g("x","z","y",1,-1,e,n,-t,s,o,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new Tt(c,3)),this.setAttribute("normal",new Tt(u,3)),this.setAttribute("uv",new Tt(_,2));function g(M,p,d,b,y,w,B,I,P,F,te){const v=w/P,E=B/F,W=w/2,V=B/2,Z=I/2,ie=P+1,X=F+1;let ne=0,G=0;const _e=new O;for(let ve=0;ve<X;ve++){const ye=ve*E-V;for(let He=0;He<ie;He++){const Be=He*v-W;_e[M]=Be*b,_e[p]=ye*y,_e[d]=Z,c.push(_e.x,_e.y,_e.z),_e[M]=0,_e[p]=0,_e[d]=I>0?1:-1,u.push(_e.x,_e.y,_e.z),_.push(He/P),_.push(1-ve/F),ne+=1}}for(let ve=0;ve<F;ve++)for(let ye=0;ye<P;ye++){const He=m+ye+ie*ve,Be=m+ye+ie*(ve+1),Y=m+(ye+1)+ie*(ve+1),re=m+(ye+1)+ie*ve;l.push(He,Be,re),l.push(Be,Y,re),G+=6}a.addGroup(h,G,te),h+=G,m+=ne}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new qi(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Ai(i){const e={};for(const t in i){e[t]={};for(const n in i[t]){const s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function xt(i){const e={};for(let t=0;t<i.length;t++){const n=Ai(i[t]);for(const s in n)e[s]=n[s]}return e}function Wu(i){const e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function rc(i){const e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Je.workingColorSpace}const Xu={clone:Ai,merge:xt};var Yu=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,qu=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class wn extends Yn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Yu,this.fragmentShader=qu,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ai(e.uniforms),this.uniformsGroups=Wu(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const s in this.uniforms){const o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class oc extends ft{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new tt,this.projectionMatrix=new tt,this.projectionMatrixInverse=new tt,this.coordinateSystem=an}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const vn=new O,Oa=new Le,Ba=new Le;class Nt extends oc{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=zo*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(Us*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return zo*2*Math.atan(Math.tan(Us*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){vn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(vn.x,vn.y).multiplyScalar(-e/vn.z),vn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(vn.x,vn.y).multiplyScalar(-e/vn.z)}getViewSize(e,t){return this.getViewBounds(e,Oa,Ba),t.subVectors(Ba,Oa)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(Us*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s;const o=this.view;if(this.view!==null&&this.view.enabled){const l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*s/l,t-=o.offsetY*n/c,s*=o.width/l,n*=o.height/c}const a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const ci=-90,ui=1;class ju extends ft{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const s=new Nt(ci,ui,e,t);s.layers=this.layers,this.add(s);const r=new Nt(ci,ui,e,t);r.layers=this.layers,this.add(r);const o=new Nt(ci,ui,e,t);o.layers=this.layers,this.add(o);const a=new Nt(ci,ui,e,t);a.layers=this.layers,this.add(a);const l=new Nt(ci,ui,e,t);l.layers=this.layers,this.add(l);const c=new Nt(ci,ui,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,l]=t;for(const c of t)this.remove(c);if(e===an)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Vs)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[r,o,a,l,c,u]=this.children,_=e.getRenderTarget(),m=e.getActiveCubeFace(),h=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;const M=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=M,e.setRenderTarget(n,5,s),e.render(t,u),e.setRenderTarget(_,m,h),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class ac extends bt{constructor(e,t,n,s,r,o,a,l,c,u){e=e!==void 0?e:[],t=t!==void 0?t:yi,super(e,t,n,s,r,o,a,l,c,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class Ku extends Gn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new ac(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:Gt}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},s=new qi(5,5,5),r=new wn({name:"CubemapFromEquirect",uniforms:Ai(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Et,blending:bn});r.uniforms.tEquirect.value=t;const o=new Ft(s,r),a=t.minFilter;return t.minFilter===kn&&(t.minFilter=Gt),new ju(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,n,s){const r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}}const Ur=new O,$u=new O,Zu=new Fe;class xn{constructor(e=new O(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const s=Ur.subVectors(n,t).cross($u.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(Ur),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||Zu.getNormalMatrix(e),s=this.coplanarPoint(Ur).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Dn=new er,Ms=new O;class ta{constructor(e=new xn,t=new xn,n=new xn,s=new xn,r=new xn,o=new xn){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){const a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=an){const n=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],l=s[3],c=s[4],u=s[5],_=s[6],m=s[7],h=s[8],g=s[9],M=s[10],p=s[11],d=s[12],b=s[13],y=s[14],w=s[15];if(n[0].setComponents(l-r,m-c,p-h,w-d).normalize(),n[1].setComponents(l+r,m+c,p+h,w+d).normalize(),n[2].setComponents(l+o,m+u,p+g,w+b).normalize(),n[3].setComponents(l-o,m-u,p-g,w-b).normalize(),n[4].setComponents(l-a,m-_,p-M,w-y).normalize(),t===an)n[5].setComponents(l+a,m+_,p+M,w+y).normalize();else if(t===Vs)n[5].setComponents(a,_,M,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Dn.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Dn.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Dn)}intersectsSprite(e){return Dn.center.set(0,0,0),Dn.radius=.7071067811865476,Dn.applyMatrix4(e.matrixWorld),this.intersectsSphere(Dn)}intersectsSphere(e){const t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const s=t[n];if(Ms.x=s.normal.x>0?e.max.x:e.min.x,Ms.y=s.normal.y>0?e.max.y:e.min.y,Ms.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Ms)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function lc(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function Ju(i){const e=new WeakMap;function t(a,l){const c=a.array,u=a.usage,_=c.byteLength,m=i.createBuffer();i.bindBuffer(l,m),i.bufferData(l,c,u),a.onUploadCallback();let h;if(c instanceof Float32Array)h=i.FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?h=i.HALF_FLOAT:h=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)h=i.SHORT;else if(c instanceof Uint32Array)h=i.UNSIGNED_INT;else if(c instanceof Int32Array)h=i.INT;else if(c instanceof Int8Array)h=i.BYTE;else if(c instanceof Uint8Array)h=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)h=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:m,type:h,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:_}}function n(a,l,c){const u=l.array,_=l.updateRanges;if(i.bindBuffer(c,a),_.length===0)i.bufferSubData(c,0,u);else{_.sort((h,g)=>h.start-g.start);let m=0;for(let h=1;h<_.length;h++){const g=_[m],M=_[h];M.start<=g.start+g.count+1?g.count=Math.max(g.count,M.start+M.count-g.start):(++m,_[m]=M)}_.length=m+1;for(let h=0,g=_.length;h<g;h++){const M=_[h];i.bufferSubData(c,M.start*u.BYTES_PER_ELEMENT,u,M.start,M.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);const l=e.get(a);l&&(i.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const u=e.get(a);(!u||u.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const c=e.get(a);if(c===void 0)e.set(a,t(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,a,l),c.version=a.version}}return{get:s,remove:r,update:o}}class nr extends Pt{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};const r=e/2,o=t/2,a=Math.floor(n),l=Math.floor(s),c=a+1,u=l+1,_=e/a,m=t/l,h=[],g=[],M=[],p=[];for(let d=0;d<u;d++){const b=d*m-o;for(let y=0;y<c;y++){const w=y*_-r;g.push(w,-b,0),M.push(0,0,1),p.push(y/a),p.push(1-d/l)}}for(let d=0;d<l;d++)for(let b=0;b<a;b++){const y=b+c*d,w=b+c*(d+1),B=b+1+c*(d+1),I=b+1+c*d;h.push(y,w,I),h.push(w,B,I)}this.setIndex(h),this.setAttribute("position",new Tt(g,3)),this.setAttribute("normal",new Tt(M,3)),this.setAttribute("uv",new Tt(p,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new nr(e.width,e.height,e.widthSegments,e.heightSegments)}}var Qu=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,eh=`#ifdef USE_ALPHAHASH
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
#endif`,th=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,nh=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,ih=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,sh=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,rh=`#ifdef USE_AOMAP
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
#endif`,oh=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,ah=`#ifdef USE_BATCHING
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
#endif`,lh=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,ch=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,uh=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,hh=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,dh=`#ifdef USE_IRIDESCENCE
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
#endif`,fh=`#ifdef USE_BUMPMAP
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
#endif`,ph=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,mh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,_h=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,gh=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,vh=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,xh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,Mh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,Sh=`#if defined( USE_COLOR_ALPHA )
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
#endif`,yh=`#define PI 3.141592653589793
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
} // validated`,Eh=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,bh=`vec3 transformedNormal = objectNormal;
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
#endif`,Th=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Ah=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,wh=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Rh=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Ch="gl_FragColor = linearToOutputTexel( gl_FragColor );",Ph=`
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
}`,Lh=`#ifdef USE_ENVMAP
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
#endif`,Dh=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Ih=`#ifdef USE_ENVMAP
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
#endif`,Nh=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Uh=`#ifdef USE_ENVMAP
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
#endif`,Fh=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Oh=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Bh=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,zh=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,kh=`#ifdef USE_GRADIENTMAP
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
}`,Hh=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Gh=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Vh=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Wh=`uniform bool receiveShadow;
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
#endif`,Xh=`#ifdef USE_ENVMAP
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
#endif`,Yh=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,qh=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,jh=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Kh=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,$h=`PhysicalMaterial material;
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
#endif`,Zh=`struct PhysicalMaterial {
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
}`,Jh=`
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
#endif`,Qh=`#if defined( RE_IndirectDiffuse )
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
#endif`,ed=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,td=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,nd=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,id=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,sd=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,rd=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,od=`#ifdef USE_MAP
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
#endif`,ld=`#if defined( USE_POINTS_UV )
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
#endif`,cd=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,ud=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,hd=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,dd=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,fd=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,pd=`#ifdef USE_MORPHTARGETS
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
#endif`,md=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,_d=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,gd=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,vd=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,xd=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Md=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Sd=`#ifdef USE_NORMALMAP
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
#endif`,yd=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Ed=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,bd=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Td=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Ad=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,wd=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,Rd=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Cd=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Pd=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Ld=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Dd=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Id=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Nd=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Ud=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Fd=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,Od=`float getShadowMask() {
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
}`,Bd=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,zd=`#ifdef USE_SKINNING
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
#endif`,kd=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Hd=`#ifdef USE_SKINNING
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
#endif`,Gd=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Vd=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Wd=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Xd=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Yd=`#ifdef USE_TRANSMISSION
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
#endif`,qd=`#ifdef USE_TRANSMISSION
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
#endif`,jd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Kd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,$d=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Zd=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Jd=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Qd=`uniform sampler2D t2D;
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
}`,ef=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,tf=`#ifdef ENVMAP_TYPE_CUBE
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
}`,nf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,sf=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,rf=`#include <common>
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
}`,of=`#if DEPTH_PACKING == 3200
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
}`,lf=`#define DISTANCE
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
}`,cf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,uf=`uniform sampler2D tEquirect;
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
}`,df=`uniform vec3 diffuse;
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
}`,ff=`#include <common>
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
}`,pf=`uniform vec3 diffuse;
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
}`,mf=`#define LAMBERT
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
}`,_f=`#define LAMBERT
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
}`,gf=`#define MATCAP
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
}`,vf=`#define MATCAP
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
}`,xf=`#define NORMAL
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
}`,Mf=`#define NORMAL
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
}`,Sf=`#define PHONG
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
}`,yf=`#define PHONG
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
}`,Ef=`#define STANDARD
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
}`,bf=`#define STANDARD
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
}`,Tf=`#define TOON
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
}`,Af=`#define TOON
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
}`,wf=`uniform float size;
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
}`,Rf=`uniform vec3 diffuse;
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
}`,Cf=`#include <common>
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
}`,Pf=`uniform vec3 color;
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
}`,Lf=`uniform float rotation;
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
}`,Df=`uniform vec3 diffuse;
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
}`,Ue={alphahash_fragment:Qu,alphahash_pars_fragment:eh,alphamap_fragment:th,alphamap_pars_fragment:nh,alphatest_fragment:ih,alphatest_pars_fragment:sh,aomap_fragment:rh,aomap_pars_fragment:oh,batching_pars_vertex:ah,batching_vertex:lh,begin_vertex:ch,beginnormal_vertex:uh,bsdfs:hh,iridescence_fragment:dh,bumpmap_pars_fragment:fh,clipping_planes_fragment:ph,clipping_planes_pars_fragment:mh,clipping_planes_pars_vertex:_h,clipping_planes_vertex:gh,color_fragment:vh,color_pars_fragment:xh,color_pars_vertex:Mh,color_vertex:Sh,common:yh,cube_uv_reflection_fragment:Eh,defaultnormal_vertex:bh,displacementmap_pars_vertex:Th,displacementmap_vertex:Ah,emissivemap_fragment:wh,emissivemap_pars_fragment:Rh,colorspace_fragment:Ch,colorspace_pars_fragment:Ph,envmap_fragment:Lh,envmap_common_pars_fragment:Dh,envmap_pars_fragment:Ih,envmap_pars_vertex:Nh,envmap_physical_pars_fragment:Xh,envmap_vertex:Uh,fog_vertex:Fh,fog_pars_vertex:Oh,fog_fragment:Bh,fog_pars_fragment:zh,gradientmap_pars_fragment:kh,lightmap_pars_fragment:Hh,lights_lambert_fragment:Gh,lights_lambert_pars_fragment:Vh,lights_pars_begin:Wh,lights_toon_fragment:Yh,lights_toon_pars_fragment:qh,lights_phong_fragment:jh,lights_phong_pars_fragment:Kh,lights_physical_fragment:$h,lights_physical_pars_fragment:Zh,lights_fragment_begin:Jh,lights_fragment_maps:Qh,lights_fragment_end:ed,logdepthbuf_fragment:td,logdepthbuf_pars_fragment:nd,logdepthbuf_pars_vertex:id,logdepthbuf_vertex:sd,map_fragment:rd,map_pars_fragment:od,map_particle_fragment:ad,map_particle_pars_fragment:ld,metalnessmap_fragment:cd,metalnessmap_pars_fragment:ud,morphinstance_vertex:hd,morphcolor_vertex:dd,morphnormal_vertex:fd,morphtarget_pars_vertex:pd,morphtarget_vertex:md,normal_fragment_begin:_d,normal_fragment_maps:gd,normal_pars_fragment:vd,normal_pars_vertex:xd,normal_vertex:Md,normalmap_pars_fragment:Sd,clearcoat_normal_fragment_begin:yd,clearcoat_normal_fragment_maps:Ed,clearcoat_pars_fragment:bd,iridescence_pars_fragment:Td,opaque_fragment:Ad,packing:wd,premultiplied_alpha_fragment:Rd,project_vertex:Cd,dithering_fragment:Pd,dithering_pars_fragment:Ld,roughnessmap_fragment:Dd,roughnessmap_pars_fragment:Id,shadowmap_pars_fragment:Nd,shadowmap_pars_vertex:Ud,shadowmap_vertex:Fd,shadowmask_pars_fragment:Od,skinbase_vertex:Bd,skinning_pars_vertex:zd,skinning_vertex:kd,skinnormal_vertex:Hd,specularmap_fragment:Gd,specularmap_pars_fragment:Vd,tonemapping_fragment:Wd,tonemapping_pars_fragment:Xd,transmission_fragment:Yd,transmission_pars_fragment:qd,uv_pars_fragment:jd,uv_pars_vertex:Kd,uv_vertex:$d,worldpos_vertex:Zd,background_vert:Jd,background_frag:Qd,backgroundCube_vert:ef,backgroundCube_frag:tf,cube_vert:nf,cube_frag:sf,depth_vert:rf,depth_frag:of,distanceRGBA_vert:af,distanceRGBA_frag:lf,equirect_vert:cf,equirect_frag:uf,linedashed_vert:hf,linedashed_frag:df,meshbasic_vert:ff,meshbasic_frag:pf,meshlambert_vert:mf,meshlambert_frag:_f,meshmatcap_vert:gf,meshmatcap_frag:vf,meshnormal_vert:xf,meshnormal_frag:Mf,meshphong_vert:Sf,meshphong_frag:yf,meshphysical_vert:Ef,meshphysical_frag:bf,meshtoon_vert:Tf,meshtoon_frag:Af,points_vert:wf,points_frag:Rf,shadow_vert:Cf,shadow_frag:Pf,sprite_vert:Lf,sprite_frag:Df},de={common:{diffuse:{value:new We(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Fe},alphaMap:{value:null},alphaMapTransform:{value:new Fe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Fe}},envmap:{envMap:{value:null},envMapRotation:{value:new Fe},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Fe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Fe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Fe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Fe},normalScale:{value:new Le(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Fe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Fe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Fe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Fe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new We(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new We(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Fe},alphaTest:{value:0},uvTransform:{value:new Fe}},sprite:{diffuse:{value:new We(16777215)},opacity:{value:1},center:{value:new Le(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Fe},alphaMap:{value:null},alphaMapTransform:{value:new Fe},alphaTest:{value:0}}},jt={basic:{uniforms:xt([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.fog]),vertexShader:Ue.meshbasic_vert,fragmentShader:Ue.meshbasic_frag},lambert:{uniforms:xt([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.fog,de.lights,{emissive:{value:new We(0)}}]),vertexShader:Ue.meshlambert_vert,fragmentShader:Ue.meshlambert_frag},phong:{uniforms:xt([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.fog,de.lights,{emissive:{value:new We(0)},specular:{value:new We(1118481)},shininess:{value:30}}]),vertexShader:Ue.meshphong_vert,fragmentShader:Ue.meshphong_frag},standard:{uniforms:xt([de.common,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.roughnessmap,de.metalnessmap,de.fog,de.lights,{emissive:{value:new We(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ue.meshphysical_vert,fragmentShader:Ue.meshphysical_frag},toon:{uniforms:xt([de.common,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.gradientmap,de.fog,de.lights,{emissive:{value:new We(0)}}]),vertexShader:Ue.meshtoon_vert,fragmentShader:Ue.meshtoon_frag},matcap:{uniforms:xt([de.common,de.bumpmap,de.normalmap,de.displacementmap,de.fog,{matcap:{value:null}}]),vertexShader:Ue.meshmatcap_vert,fragmentShader:Ue.meshmatcap_frag},points:{uniforms:xt([de.points,de.fog]),vertexShader:Ue.points_vert,fragmentShader:Ue.points_frag},dashed:{uniforms:xt([de.common,de.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ue.linedashed_vert,fragmentShader:Ue.linedashed_frag},depth:{uniforms:xt([de.common,de.displacementmap]),vertexShader:Ue.depth_vert,fragmentShader:Ue.depth_frag},normal:{uniforms:xt([de.common,de.bumpmap,de.normalmap,de.displacementmap,{opacity:{value:1}}]),vertexShader:Ue.meshnormal_vert,fragmentShader:Ue.meshnormal_frag},sprite:{uniforms:xt([de.sprite,de.fog]),vertexShader:Ue.sprite_vert,fragmentShader:Ue.sprite_frag},background:{uniforms:{uvTransform:{value:new Fe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ue.background_vert,fragmentShader:Ue.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Fe}},vertexShader:Ue.backgroundCube_vert,fragmentShader:Ue.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ue.cube_vert,fragmentShader:Ue.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ue.equirect_vert,fragmentShader:Ue.equirect_frag},distanceRGBA:{uniforms:xt([de.common,de.displacementmap,{referencePosition:{value:new O},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ue.distanceRGBA_vert,fragmentShader:Ue.distanceRGBA_frag},shadow:{uniforms:xt([de.lights,de.fog,{color:{value:new We(0)},opacity:{value:1}}]),vertexShader:Ue.shadow_vert,fragmentShader:Ue.shadow_frag}};jt.physical={uniforms:xt([jt.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Fe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Fe},clearcoatNormalScale:{value:new Le(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Fe},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Fe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Fe},sheen:{value:0},sheenColor:{value:new We(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Fe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Fe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Fe},transmissionSamplerSize:{value:new Le},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Fe},attenuationDistance:{value:0},attenuationColor:{value:new We(0)},specularColor:{value:new We(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Fe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Fe},anisotropyVector:{value:new Le},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Fe}}]),vertexShader:Ue.meshphysical_vert,fragmentShader:Ue.meshphysical_frag};const Ss={r:0,b:0,g:0},In=new Zt,If=new tt;function Nf(i,e,t,n,s,r,o){const a=new We(0);let l=r===!0?0:1,c,u,_=null,m=0,h=null;function g(b){let y=b.isScene===!0?b.background:null;return y&&y.isTexture&&(y=(b.backgroundBlurriness>0?t:e).get(y)),y}function M(b){let y=!1;const w=g(b);w===null?d(a,l):w&&w.isColor&&(d(w,1),y=!0);const B=i.xr.getEnvironmentBlendMode();B==="additive"?n.buffers.color.setClear(0,0,0,1,o):B==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||y)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function p(b,y){const w=g(y);w&&(w.isCubeTexture||w.mapping===Js)?(u===void 0&&(u=new Ft(new qi(1,1,1),new wn({name:"BackgroundCubeMaterial",uniforms:Ai(jt.backgroundCube.uniforms),vertexShader:jt.backgroundCube.vertexShader,fragmentShader:jt.backgroundCube.fragmentShader,side:Et,depthTest:!1,depthWrite:!1,fog:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(B,I,P){this.matrixWorld.copyPosition(P.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(u)),In.copy(y.backgroundRotation),In.x*=-1,In.y*=-1,In.z*=-1,w.isCubeTexture&&w.isRenderTargetTexture===!1&&(In.y*=-1,In.z*=-1),u.material.uniforms.envMap.value=w,u.material.uniforms.flipEnvMap.value=w.isCubeTexture&&w.isRenderTargetTexture===!1?-1:1,u.material.uniforms.backgroundBlurriness.value=y.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(If.makeRotationFromEuler(In)),u.material.toneMapped=Je.getTransfer(w.colorSpace)!==nt,(_!==w||m!==w.version||h!==i.toneMapping)&&(u.material.needsUpdate=!0,_=w,m=w.version,h=i.toneMapping),u.layers.enableAll(),b.unshift(u,u.geometry,u.material,0,0,null)):w&&w.isTexture&&(c===void 0&&(c=new Ft(new nr(2,2),new wn({name:"BackgroundMaterial",uniforms:Ai(jt.background.uniforms),vertexShader:jt.background.vertexShader,fragmentShader:jt.background.fragmentShader,side:An,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=w,c.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,c.material.toneMapped=Je.getTransfer(w.colorSpace)!==nt,w.matrixAutoUpdate===!0&&w.updateMatrix(),c.material.uniforms.uvTransform.value.copy(w.matrix),(_!==w||m!==w.version||h!==i.toneMapping)&&(c.material.needsUpdate=!0,_=w,m=w.version,h=i.toneMapping),c.layers.enableAll(),b.unshift(c,c.geometry,c.material,0,0,null))}function d(b,y){b.getRGB(Ss,rc(i)),n.buffers.color.setClear(Ss.r,Ss.g,Ss.b,y,o)}return{getClearColor:function(){return a},setClearColor:function(b,y=1){a.set(b),l=y,d(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(b){l=b,d(a,l)},render:M,addToRenderList:p}}function Uf(i,e){const t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=m(null);let r=s,o=!1;function a(v,E,W,V,Z){let ie=!1;const X=_(V,W,E);r!==X&&(r=X,c(r.object)),ie=h(v,V,W,Z),ie&&g(v,V,W,Z),Z!==null&&e.update(Z,i.ELEMENT_ARRAY_BUFFER),(ie||o)&&(o=!1,w(v,E,W,V),Z!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(Z).buffer))}function l(){return i.createVertexArray()}function c(v){return i.bindVertexArray(v)}function u(v){return i.deleteVertexArray(v)}function _(v,E,W){const V=W.wireframe===!0;let Z=n[v.id];Z===void 0&&(Z={},n[v.id]=Z);let ie=Z[E.id];ie===void 0&&(ie={},Z[E.id]=ie);let X=ie[V];return X===void 0&&(X=m(l()),ie[V]=X),X}function m(v){const E=[],W=[],V=[];for(let Z=0;Z<t;Z++)E[Z]=0,W[Z]=0,V[Z]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:E,enabledAttributes:W,attributeDivisors:V,object:v,attributes:{},index:null}}function h(v,E,W,V){const Z=r.attributes,ie=E.attributes;let X=0;const ne=W.getAttributes();for(const G in ne)if(ne[G].location>=0){const ve=Z[G];let ye=ie[G];if(ye===void 0&&(G==="instanceMatrix"&&v.instanceMatrix&&(ye=v.instanceMatrix),G==="instanceColor"&&v.instanceColor&&(ye=v.instanceColor)),ve===void 0||ve.attribute!==ye||ye&&ve.data!==ye.data)return!0;X++}return r.attributesNum!==X||r.index!==V}function g(v,E,W,V){const Z={},ie=E.attributes;let X=0;const ne=W.getAttributes();for(const G in ne)if(ne[G].location>=0){let ve=ie[G];ve===void 0&&(G==="instanceMatrix"&&v.instanceMatrix&&(ve=v.instanceMatrix),G==="instanceColor"&&v.instanceColor&&(ve=v.instanceColor));const ye={};ye.attribute=ve,ve&&ve.data&&(ye.data=ve.data),Z[G]=ye,X++}r.attributes=Z,r.attributesNum=X,r.index=V}function M(){const v=r.newAttributes;for(let E=0,W=v.length;E<W;E++)v[E]=0}function p(v){d(v,0)}function d(v,E){const W=r.newAttributes,V=r.enabledAttributes,Z=r.attributeDivisors;W[v]=1,V[v]===0&&(i.enableVertexAttribArray(v),V[v]=1),Z[v]!==E&&(i.vertexAttribDivisor(v,E),Z[v]=E)}function b(){const v=r.newAttributes,E=r.enabledAttributes;for(let W=0,V=E.length;W<V;W++)E[W]!==v[W]&&(i.disableVertexAttribArray(W),E[W]=0)}function y(v,E,W,V,Z,ie,X){X===!0?i.vertexAttribIPointer(v,E,W,Z,ie):i.vertexAttribPointer(v,E,W,V,Z,ie)}function w(v,E,W,V){M();const Z=V.attributes,ie=W.getAttributes(),X=E.defaultAttributeValues;for(const ne in ie){const G=ie[ne];if(G.location>=0){let _e=Z[ne];if(_e===void 0&&(ne==="instanceMatrix"&&v.instanceMatrix&&(_e=v.instanceMatrix),ne==="instanceColor"&&v.instanceColor&&(_e=v.instanceColor)),_e!==void 0){const ve=_e.normalized,ye=_e.itemSize,He=e.get(_e);if(He===void 0)continue;const Be=He.buffer,Y=He.type,re=He.bytesPerElement,Me=Y===i.INT||Y===i.UNSIGNED_INT||_e.gpuType===Yo;if(_e.isInterleavedBufferAttribute){const Se=_e.data,De=Se.stride,Re=_e.offset;if(Se.isInstancedInterleavedBuffer){for(let Xe=0;Xe<G.locationSize;Xe++)d(G.location+Xe,Se.meshPerAttribute);v.isInstancedMesh!==!0&&V._maxInstanceCount===void 0&&(V._maxInstanceCount=Se.meshPerAttribute*Se.count)}else for(let Xe=0;Xe<G.locationSize;Xe++)p(G.location+Xe);i.bindBuffer(i.ARRAY_BUFFER,Be);for(let Xe=0;Xe<G.locationSize;Xe++)y(G.location+Xe,ye/G.locationSize,Y,ve,De*re,(Re+ye/G.locationSize*Xe)*re,Me)}else{if(_e.isInstancedBufferAttribute){for(let Se=0;Se<G.locationSize;Se++)d(G.location+Se,_e.meshPerAttribute);v.isInstancedMesh!==!0&&V._maxInstanceCount===void 0&&(V._maxInstanceCount=_e.meshPerAttribute*_e.count)}else for(let Se=0;Se<G.locationSize;Se++)p(G.location+Se);i.bindBuffer(i.ARRAY_BUFFER,Be);for(let Se=0;Se<G.locationSize;Se++)y(G.location+Se,ye/G.locationSize,Y,ve,ye*re,ye/G.locationSize*Se*re,Me)}}else if(X!==void 0){const ve=X[ne];if(ve!==void 0)switch(ve.length){case 2:i.vertexAttrib2fv(G.location,ve);break;case 3:i.vertexAttrib3fv(G.location,ve);break;case 4:i.vertexAttrib4fv(G.location,ve);break;default:i.vertexAttrib1fv(G.location,ve)}}}}b()}function B(){F();for(const v in n){const E=n[v];for(const W in E){const V=E[W];for(const Z in V)u(V[Z].object),delete V[Z];delete E[W]}delete n[v]}}function I(v){if(n[v.id]===void 0)return;const E=n[v.id];for(const W in E){const V=E[W];for(const Z in V)u(V[Z].object),delete V[Z];delete E[W]}delete n[v.id]}function P(v){for(const E in n){const W=n[E];if(W[v.id]===void 0)continue;const V=W[v.id];for(const Z in V)u(V[Z].object),delete V[Z];delete W[v.id]}}function F(){te(),o=!0,r!==s&&(r=s,c(r.object))}function te(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:a,reset:F,resetDefaultState:te,dispose:B,releaseStatesOfGeometry:I,releaseStatesOfProgram:P,initAttributes:M,enableAttribute:p,disableUnusedAttributes:b}}function Ff(i,e,t){let n;function s(c){n=c}function r(c,u){i.drawArrays(n,c,u),t.update(u,n,1)}function o(c,u,_){_!==0&&(i.drawArraysInstanced(n,c,u,_),t.update(u,n,_))}function a(c,u,_){if(_===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,u,0,_);let h=0;for(let g=0;g<_;g++)h+=u[g];t.update(h,n,1)}function l(c,u,_,m){if(_===0)return;const h=e.get("WEBGL_multi_draw");if(h===null)for(let g=0;g<c.length;g++)o(c[g],u[g],m[g]);else{h.multiDrawArraysInstancedWEBGL(n,c,0,u,0,m,0,_);let g=0;for(let M=0;M<_;M++)g+=u[M];for(let M=0;M<m.length;M++)t.update(g,n,m[M])}}this.setMode=s,this.render=r,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=l}function Of(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){const P=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(P.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function o(P){return!(P!==Wt&&n.convert(P)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(P){const F=P===Wi&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(P!==cn&&n.convert(P)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&P!==on&&!F)}function l(P){if(P==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";P="mediump"}return P==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp";const u=l(c);u!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",u,"instead."),c=u);const _=t.logarithmicDepthBuffer===!0,m=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control");if(m===!0){const P=e.get("EXT_clip_control");P.clipControlEXT(P.LOWER_LEFT_EXT,P.ZERO_TO_ONE_EXT)}const h=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),M=i.getParameter(i.MAX_TEXTURE_SIZE),p=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),d=i.getParameter(i.MAX_VERTEX_ATTRIBS),b=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),y=i.getParameter(i.MAX_VARYING_VECTORS),w=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),B=g>0,I=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:_,reverseDepthBuffer:m,maxTextures:h,maxVertexTextures:g,maxTextureSize:M,maxCubemapSize:p,maxAttributes:d,maxVertexUniforms:b,maxVaryings:y,maxFragmentUniforms:w,vertexTextures:B,maxSamples:I}}function Bf(i){const e=this;let t=null,n=0,s=!1,r=!1;const o=new xn,a=new Fe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(_,m){const h=_.length!==0||m||n!==0||s;return s=m,n=_.length,h},this.beginShadows=function(){r=!0,u(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(_,m){t=u(_,m,0)},this.setState=function(_,m,h){const g=_.clippingPlanes,M=_.clipIntersection,p=_.clipShadows,d=i.get(_);if(!s||g===null||g.length===0||r&&!p)r?u(null):c();else{const b=r?0:n,y=b*4;let w=d.clippingState||null;l.value=w,w=u(g,m,y,h);for(let B=0;B!==y;++B)w[B]=t[B];d.clippingState=w,this.numIntersection=M?this.numPlanes:0,this.numPlanes+=b}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function u(_,m,h,g){const M=_!==null?_.length:0;let p=null;if(M!==0){if(p=l.value,g!==!0||p===null){const d=h+M*4,b=m.matrixWorldInverse;a.getNormalMatrix(b),(p===null||p.length<d)&&(p=new Float32Array(d));for(let y=0,w=h;y!==M;++y,w+=4)o.copy(_[y]).applyMatrix4(b,a),o.normal.toArray(p,w),p[w+3]=o.constant}l.value=p,l.needsUpdate=!0}return e.numPlanes=M,e.numIntersection=0,p}}function zf(i){let e=new WeakMap;function t(o,a){return a===lo?o.mapping=yi:a===co&&(o.mapping=Ei),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===lo||a===co)if(e.has(o)){const l=e.get(o).texture;return t(l,o.mapping)}else{const l=o.image;if(l&&l.height>0){const c=new Ku(l.height);return c.fromEquirectangularTexture(i,o),e.set(o,c),o.addEventListener("dispose",s),t(c.texture,o.mapping)}else return null}}return o}function s(o){const a=o.target;a.removeEventListener("dispose",s);const l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}class cc extends oc{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2;let r=n-e,o=n+e,a=s+t,l=s-t;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=u*this.view.offsetY,l=a-u*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}const pi=4,za=[.125,.215,.35,.446,.526,.582],Bn=20,Fr=new cc,ka=new We;let Or=null,Br=0,zr=0,kr=!1;const Fn=(1+Math.sqrt(5))/2,hi=1/Fn,Ha=[new O(-Fn,hi,0),new O(Fn,hi,0),new O(-hi,0,Fn),new O(hi,0,Fn),new O(0,Fn,-hi),new O(0,Fn,hi),new O(-1,1,-1),new O(1,1,-1),new O(-1,1,1),new O(1,1,1)];class Ga{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){Or=this._renderer.getRenderTarget(),Br=this._renderer.getActiveCubeFace(),zr=this._renderer.getActiveMipmapLevel(),kr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Xa(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Wa(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Or,Br,zr),this._renderer.xr.enabled=kr,e.scissorTest=!1,ys(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===yi||e.mapping===Ei?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Or=this._renderer.getRenderTarget(),Br=this._renderer.getActiveCubeFace(),zr=this._renderer.getActiveMipmapLevel(),kr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Gt,minFilter:Gt,generateMipmaps:!1,type:Wi,format:Wt,colorSpace:Rn,depthBuffer:!1},s=Va(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Va(e,t,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=kf(r)),this._blurMaterial=Hf(r,e,t)}return s}_compileMaterial(e){const t=new Ft(this._lodPlanes[0],e);this._renderer.compile(t,Fr)}_sceneToCubeUV(e,t,n,s){const a=new Nt(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],u=this._renderer,_=u.autoClear,m=u.toneMapping;u.getClearColor(ka),u.toneMapping=Tn,u.autoClear=!1;const h=new ea({name:"PMREM.Background",side:Et,depthWrite:!1,depthTest:!1}),g=new Ft(new qi,h);let M=!1;const p=e.background;p?p.isColor&&(h.color.copy(p),e.background=null,M=!0):(h.color.copy(ka),M=!0);for(let d=0;d<6;d++){const b=d%3;b===0?(a.up.set(0,l[d],0),a.lookAt(c[d],0,0)):b===1?(a.up.set(0,0,l[d]),a.lookAt(0,c[d],0)):(a.up.set(0,l[d],0),a.lookAt(0,0,c[d]));const y=this._cubeSize;ys(s,b*y,d>2?y:0,y,y),u.setRenderTarget(s),M&&u.render(g,a),u.render(e,a)}g.geometry.dispose(),g.material.dispose(),u.toneMapping=m,u.autoClear=_,e.background=p}_textureToCubeUV(e,t){const n=this._renderer,s=e.mapping===yi||e.mapping===Ei;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Xa()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Wa());const r=s?this._cubemapMaterial:this._equirectMaterial,o=new Ft(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;const l=this._cubeSize;ys(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(o,Fr)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;const s=this._lodPlanes.length;for(let r=1;r<s;r++){const o=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),a=Ha[(s-r-1)%Ha.length];this._blur(e,r-1,r,o,a)}t.autoClear=n}_blur(e,t,n,s,r){const o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){const l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const u=3,_=new Ft(this._lodPlanes[s],c),m=c.uniforms,h=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*h):2*Math.PI/(2*Bn-1),M=r/g,p=isFinite(r)?1+Math.floor(u*M):Bn;p>Bn&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${p} samples when the maximum is set to ${Bn}`);const d=[];let b=0;for(let P=0;P<Bn;++P){const F=P/M,te=Math.exp(-F*F/2);d.push(te),P===0?b+=te:P<p&&(b+=2*te)}for(let P=0;P<d.length;P++)d[P]=d[P]/b;m.envMap.value=e.texture,m.samples.value=p,m.weights.value=d,m.latitudinal.value=o==="latitudinal",a&&(m.poleAxis.value=a);const{_lodMax:y}=this;m.dTheta.value=g,m.mipInt.value=y-n;const w=this._sizeLods[s],B=3*w*(s>y-pi?s-y+pi:0),I=4*(this._cubeSize-w);ys(t,B,I,3*w,2*w),l.setRenderTarget(t),l.render(_,Fr)}}function kf(i){const e=[],t=[],n=[];let s=i;const r=i-pi+1+za.length;for(let o=0;o<r;o++){const a=Math.pow(2,s);t.push(a);let l=1/a;o>i-pi?l=za[o-i+pi-1]:o===0&&(l=0),n.push(l);const c=1/(a-2),u=-c,_=1+c,m=[u,u,_,u,_,_,u,u,_,_,u,_],h=6,g=6,M=3,p=2,d=1,b=new Float32Array(M*g*h),y=new Float32Array(p*g*h),w=new Float32Array(d*g*h);for(let I=0;I<h;I++){const P=I%3*2/3-1,F=I>2?0:-1,te=[P,F,0,P+2/3,F,0,P+2/3,F+1,0,P,F,0,P+2/3,F+1,0,P,F+1,0];b.set(te,M*g*I),y.set(m,p*g*I);const v=[I,I,I,I,I,I];w.set(v,d*g*I)}const B=new Pt;B.setAttribute("position",new $t(b,M)),B.setAttribute("uv",new $t(y,p)),B.setAttribute("faceIndex",new $t(w,d)),e.push(B),s>pi&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Va(i,e,t){const n=new Gn(i,e,t);return n.texture.mapping=Js,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function ys(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function Hf(i,e,t){const n=new Float32Array(Bn),s=new O(0,1,0);return new wn({name:"SphericalGaussianBlur",defines:{n:Bn,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:na(),fragmentShader:`

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
		`,blending:bn,depthTest:!1,depthWrite:!1})}function Wa(){return new wn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:na(),fragmentShader:`

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
		`,blending:bn,depthTest:!1,depthWrite:!1})}function Xa(){return new wn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:na(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:bn,depthTest:!1,depthWrite:!1})}function na(){return`

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
	`}function Gf(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){const l=a.mapping,c=l===lo||l===co,u=l===yi||l===Ei;if(c||u){let _=e.get(a);const m=_!==void 0?_.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==m)return t===null&&(t=new Ga(i)),_=c?t.fromEquirectangular(a,_):t.fromCubemap(a,_),_.texture.pmremVersion=a.pmremVersion,e.set(a,_),_.texture;if(_!==void 0)return _.texture;{const h=a.image;return c&&h&&h.height>0||u&&h&&s(h)?(t===null&&(t=new Ga(i)),_=c?t.fromEquirectangular(a):t.fromCubemap(a),_.texture.pmremVersion=a.pmremVersion,e.set(a,_),a.addEventListener("dispose",r),_.texture):null}}}return a}function s(a){let l=0;const c=6;for(let u=0;u<c;u++)a[u]!==void 0&&l++;return l===c}function r(a){const l=a.target;l.removeEventListener("dispose",r);const c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function Vf(i){const e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){const s=t(n);return s===null&&Fs("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function Wf(i,e,t,n){const s={},r=new WeakMap;function o(_){const m=_.target;m.index!==null&&e.remove(m.index);for(const g in m.attributes)e.remove(m.attributes[g]);for(const g in m.morphAttributes){const M=m.morphAttributes[g];for(let p=0,d=M.length;p<d;p++)e.remove(M[p])}m.removeEventListener("dispose",o),delete s[m.id];const h=r.get(m);h&&(e.remove(h),r.delete(m)),n.releaseStatesOfGeometry(m),m.isInstancedBufferGeometry===!0&&delete m._maxInstanceCount,t.memory.geometries--}function a(_,m){return s[m.id]===!0||(m.addEventListener("dispose",o),s[m.id]=!0,t.memory.geometries++),m}function l(_){const m=_.attributes;for(const g in m)e.update(m[g],i.ARRAY_BUFFER);const h=_.morphAttributes;for(const g in h){const M=h[g];for(let p=0,d=M.length;p<d;p++)e.update(M[p],i.ARRAY_BUFFER)}}function c(_){const m=[],h=_.index,g=_.attributes.position;let M=0;if(h!==null){const b=h.array;M=h.version;for(let y=0,w=b.length;y<w;y+=3){const B=b[y+0],I=b[y+1],P=b[y+2];m.push(B,I,I,P,P,B)}}else if(g!==void 0){const b=g.array;M=g.version;for(let y=0,w=b.length/3-1;y<w;y+=3){const B=y+0,I=y+1,P=y+2;m.push(B,I,I,P,P,B)}}else return;const p=new(Ql(m)?sc:ic)(m,1);p.version=M;const d=r.get(_);d&&e.remove(d),r.set(_,p)}function u(_){const m=r.get(_);if(m){const h=_.index;h!==null&&m.version<h.version&&c(_)}else c(_);return r.get(_)}return{get:a,update:l,getWireframeAttribute:u}}function Xf(i,e,t){let n;function s(m){n=m}let r,o;function a(m){r=m.type,o=m.bytesPerElement}function l(m,h){i.drawElements(n,h,r,m*o),t.update(h,n,1)}function c(m,h,g){g!==0&&(i.drawElementsInstanced(n,h,r,m*o,g),t.update(h,n,g))}function u(m,h,g){if(g===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,h,0,r,m,0,g);let p=0;for(let d=0;d<g;d++)p+=h[d];t.update(p,n,1)}function _(m,h,g,M){if(g===0)return;const p=e.get("WEBGL_multi_draw");if(p===null)for(let d=0;d<m.length;d++)c(m[d]/o,h[d],M[d]);else{p.multiDrawElementsInstancedWEBGL(n,h,0,r,m,0,M,0,g);let d=0;for(let b=0;b<g;b++)d+=h[b];for(let b=0;b<M.length;b++)t.update(d,n,M[b])}}this.setMode=s,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=u,this.renderMultiDrawInstances=_}function Yf(i){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function qf(i,e,t){const n=new WeakMap,s=new rt;function r(o,a,l){const c=o.morphTargetInfluences,u=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,_=u!==void 0?u.length:0;let m=n.get(a);if(m===void 0||m.count!==_){let v=function(){F.dispose(),n.delete(a),a.removeEventListener("dispose",v)};var h=v;m!==void 0&&m.texture.dispose();const g=a.morphAttributes.position!==void 0,M=a.morphAttributes.normal!==void 0,p=a.morphAttributes.color!==void 0,d=a.morphAttributes.position||[],b=a.morphAttributes.normal||[],y=a.morphAttributes.color||[];let w=0;g===!0&&(w=1),M===!0&&(w=2),p===!0&&(w=3);let B=a.attributes.position.count*w,I=1;B>e.maxTextureSize&&(I=Math.ceil(B/e.maxTextureSize),B=e.maxTextureSize);const P=new Float32Array(B*I*4*_),F=new tc(P,B,I,_);F.type=on,F.needsUpdate=!0;const te=w*4;for(let E=0;E<_;E++){const W=d[E],V=b[E],Z=y[E],ie=B*I*4*E;for(let X=0;X<W.count;X++){const ne=X*te;g===!0&&(s.fromBufferAttribute(W,X),P[ie+ne+0]=s.x,P[ie+ne+1]=s.y,P[ie+ne+2]=s.z,P[ie+ne+3]=0),M===!0&&(s.fromBufferAttribute(V,X),P[ie+ne+4]=s.x,P[ie+ne+5]=s.y,P[ie+ne+6]=s.z,P[ie+ne+7]=0),p===!0&&(s.fromBufferAttribute(Z,X),P[ie+ne+8]=s.x,P[ie+ne+9]=s.y,P[ie+ne+10]=s.z,P[ie+ne+11]=Z.itemSize===4?s.w:1)}}m={count:_,texture:F,size:new Le(B,I)},n.set(a,m),a.addEventListener("dispose",v)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",o.morphTexture,t);else{let g=0;for(let p=0;p<c.length;p++)g+=c[p];const M=a.morphTargetsRelative?1:1-g;l.getUniforms().setValue(i,"morphTargetBaseInfluence",M),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",m.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",m.size)}return{update:r}}function jf(i,e,t,n){let s=new WeakMap;function r(l){const c=n.render.frame,u=l.geometry,_=e.get(l,u);if(s.get(_)!==c&&(e.update(_),s.set(_,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){const m=l.skeleton;s.get(m)!==c&&(m.update(),s.set(m,c))}return _}function o(){s=new WeakMap}function a(l){const c=l.target;c.removeEventListener("dispose",a),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:o}}class uc extends bt{constructor(e,t,n,s,r,o,a,l,c,u=gi){if(u!==gi&&u!==Ti)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&u===gi&&(n=Hn),n===void 0&&u===Ti&&(n=bi),super(null,s,r,o,a,l,u,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:Ut,this.minFilter=l!==void 0?l:Ut,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}const hc=new bt,Ya=new uc(1,1),dc=new tc,fc=new Iu,pc=new ac,qa=[],ja=[],Ka=new Float32Array(16),$a=new Float32Array(9),Za=new Float32Array(4);function Ci(i,e,t){const n=i[0];if(n<=0||n>0)return i;const s=e*t;let r=qa[s];if(r===void 0&&(r=new Float32Array(s),qa[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function ut(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function ht(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function ir(i,e){let t=ja[e];t===void 0&&(t=new Int32Array(e),ja[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function Kf(i,e){const t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function $f(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ut(t,e))return;i.uniform2fv(this.addr,e),ht(t,e)}}function Zf(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(ut(t,e))return;i.uniform3fv(this.addr,e),ht(t,e)}}function Jf(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ut(t,e))return;i.uniform4fv(this.addr,e),ht(t,e)}}function Qf(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ut(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),ht(t,e)}else{if(ut(t,n))return;Za.set(n),i.uniformMatrix2fv(this.addr,!1,Za),ht(t,n)}}function ep(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ut(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),ht(t,e)}else{if(ut(t,n))return;$a.set(n),i.uniformMatrix3fv(this.addr,!1,$a),ht(t,n)}}function tp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ut(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),ht(t,e)}else{if(ut(t,n))return;Ka.set(n),i.uniformMatrix4fv(this.addr,!1,Ka),ht(t,n)}}function np(i,e){const t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function ip(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ut(t,e))return;i.uniform2iv(this.addr,e),ht(t,e)}}function sp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ut(t,e))return;i.uniform3iv(this.addr,e),ht(t,e)}}function rp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ut(t,e))return;i.uniform4iv(this.addr,e),ht(t,e)}}function op(i,e){const t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function ap(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ut(t,e))return;i.uniform2uiv(this.addr,e),ht(t,e)}}function lp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ut(t,e))return;i.uniform3uiv(this.addr,e),ht(t,e)}}function cp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ut(t,e))return;i.uniform4uiv(this.addr,e),ht(t,e)}}function up(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(Ya.compareFunction=Jl,r=Ya):r=hc,t.setTexture2D(e||r,s)}function hp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||fc,s)}function dp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||pc,s)}function fp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||dc,s)}function pp(i){switch(i){case 5126:return Kf;case 35664:return $f;case 35665:return Zf;case 35666:return Jf;case 35674:return Qf;case 35675:return ep;case 35676:return tp;case 5124:case 35670:return np;case 35667:case 35671:return ip;case 35668:case 35672:return sp;case 35669:case 35673:return rp;case 5125:return op;case 36294:return ap;case 36295:return lp;case 36296:return cp;case 35678:case 36198:case 36298:case 36306:case 35682:return up;case 35679:case 36299:case 36307:return hp;case 35680:case 36300:case 36308:case 36293:return dp;case 36289:case 36303:case 36311:case 36292:return fp}}function mp(i,e){i.uniform1fv(this.addr,e)}function _p(i,e){const t=Ci(e,this.size,2);i.uniform2fv(this.addr,t)}function gp(i,e){const t=Ci(e,this.size,3);i.uniform3fv(this.addr,t)}function vp(i,e){const t=Ci(e,this.size,4);i.uniform4fv(this.addr,t)}function xp(i,e){const t=Ci(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function Mp(i,e){const t=Ci(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function Sp(i,e){const t=Ci(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function yp(i,e){i.uniform1iv(this.addr,e)}function Ep(i,e){i.uniform2iv(this.addr,e)}function bp(i,e){i.uniform3iv(this.addr,e)}function Tp(i,e){i.uniform4iv(this.addr,e)}function Ap(i,e){i.uniform1uiv(this.addr,e)}function wp(i,e){i.uniform2uiv(this.addr,e)}function Rp(i,e){i.uniform3uiv(this.addr,e)}function Cp(i,e){i.uniform4uiv(this.addr,e)}function Pp(i,e,t){const n=this.cache,s=e.length,r=ir(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),ht(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||hc,r[o])}function Lp(i,e,t){const n=this.cache,s=e.length,r=ir(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),ht(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||fc,r[o])}function Dp(i,e,t){const n=this.cache,s=e.length,r=ir(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),ht(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||pc,r[o])}function Ip(i,e,t){const n=this.cache,s=e.length,r=ir(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),ht(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||dc,r[o])}function Np(i){switch(i){case 5126:return mp;case 35664:return _p;case 35665:return gp;case 35666:return vp;case 35674:return xp;case 35675:return Mp;case 35676:return Sp;case 5124:case 35670:return yp;case 35667:case 35671:return Ep;case 35668:case 35672:return bp;case 35669:case 35673:return Tp;case 5125:return Ap;case 36294:return wp;case 36295:return Rp;case 36296:return Cp;case 35678:case 36198:case 36298:case 36306:case 35682:return Pp;case 35679:case 36299:case 36307:return Lp;case 35680:case 36300:case 36308:case 36293:return Dp;case 36289:case 36303:case 36311:case 36292:return Ip}}class Up{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=pp(t.type)}}class Fp{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Np(t.type)}}class Op{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const s=this.seq;for(let r=0,o=s.length;r!==o;++r){const a=s[r];a.setValue(e,t[a.id],n)}}}const Hr=/(\w+)(\])?(\[|\.)?/g;function Ja(i,e){i.seq.push(e),i.map[e.id]=e}function Bp(i,e,t){const n=i.name,s=n.length;for(Hr.lastIndex=0;;){const r=Hr.exec(n),o=Hr.lastIndex;let a=r[1];const l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===s){Ja(t,c===void 0?new Up(a,i,e):new Fp(a,i,e));break}else{let _=t.map[a];_===void 0&&(_=new Op(a),Ja(t,_)),t=_}}}class Os{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){const r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);Bp(r,o,this)}}setValue(e,t,n,s){const r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){const s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){const a=t[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,s)}}static seqWithValue(e,t){const n=[];for(let s=0,r=e.length;s!==r;++s){const o=e[s];o.id in t&&n.push(o)}return n}}function Qa(i,e,t){const n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}const zp=37297;let kp=0;function Hp(i,e){const t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){const a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}function Gp(i){const e=Je.getPrimaries(Je.workingColorSpace),t=Je.getPrimaries(i);let n;switch(e===t?n="":e===Gs&&t===Hs?n="LinearDisplayP3ToLinearSRGB":e===Hs&&t===Gs&&(n="LinearSRGBToLinearDisplayP3"),i){case Rn:case Qs:return[n,"LinearTransferOETF"];case qt:case Jo:return[n,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",i),[n,"LinearTransferOETF"]}}function el(i,e,t){const n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";const r=/ERROR: 0:(\d+)/.exec(s);if(r){const o=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+Hp(i.getShaderSource(e),o)}else return s}function Vp(i,e){const t=Gp(e);return`vec4 ${i}( vec4 value ) { return ${t[0]}( ${t[1]}( value ) ); }`}function Wp(i,e){let t;switch(e){case su:t="Linear";break;case ru:t="Reinhard";break;case ou:t="Cineon";break;case au:t="ACESFilmic";break;case cu:t="AgX";break;case uu:t="Neutral";break;case lu:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const Es=new O;function Xp(){Je.getLuminanceCoefficients(Es);const i=Es.x.toFixed(4),e=Es.y.toFixed(4),t=Es.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Yp(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Bi).join(`
`)}function qp(i){const e=[];for(const t in i){const n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function jp(i,e){const t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){const r=i.getActiveAttrib(e,s),o=r.name;let a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function Bi(i){return i!==""}function tl(i,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function nl(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const Kp=/^[ \t]*#include +<([\w\d./]+)>/gm;function ko(i){return i.replace(Kp,Zp)}const $p=new Map;function Zp(i,e){let t=Ue[e];if(t===void 0){const n=$p.get(e);if(n!==void 0)t=Ue[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return ko(t)}const Jp=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function il(i){return i.replace(Jp,Qp)}function Qp(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function sl(i){let e=`precision ${i.precision} float;
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
#define LOW_PRECISION`),e}function em(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===Bl?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===Oc?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===sn&&(e="SHADOWMAP_TYPE_VSM"),e}function tm(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case yi:case Ei:e="ENVMAP_TYPE_CUBE";break;case Js:e="ENVMAP_TYPE_CUBE_UV";break}return e}function nm(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Ei:e="ENVMAP_MODE_REFRACTION";break}return e}function im(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case zl:e="ENVMAP_BLENDING_MULTIPLY";break;case nu:e="ENVMAP_BLENDING_MIX";break;case iu:e="ENVMAP_BLENDING_ADD";break}return e}function sm(i){const e=i.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function rm(i,e,t,n){const s=i.getContext(),r=t.defines;let o=t.vertexShader,a=t.fragmentShader;const l=em(t),c=tm(t),u=nm(t),_=im(t),m=sm(t),h=Yp(t),g=qp(r),M=s.createProgram();let p,d,b=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(Bi).join(`
`),p.length>0&&(p+=`
`),d=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(Bi).join(`
`),d.length>0&&(d+=`
`)):(p=[sl(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Bi).join(`
`),d=[sl(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+u:"",t.envMap?"#define "+_:"",m?"#define CUBEUV_TEXEL_WIDTH "+m.texelWidth:"",m?"#define CUBEUV_TEXEL_HEIGHT "+m.texelHeight:"",m?"#define CUBEUV_MAX_MIP "+m.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Tn?"#define TONE_MAPPING":"",t.toneMapping!==Tn?Ue.tonemapping_pars_fragment:"",t.toneMapping!==Tn?Wp("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Ue.colorspace_pars_fragment,Vp("linearToOutputTexel",t.outputColorSpace),Xp(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(Bi).join(`
`)),o=ko(o),o=tl(o,t),o=nl(o,t),a=ko(a),a=tl(a,t),a=nl(a,t),o=il(o),a=il(a),t.isRawShaderMaterial!==!0&&(b=`#version 300 es
`,p=[h,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+p,d=["#define varying in",t.glslVersion===Sa?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Sa?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+d);const y=b+p+o,w=b+d+a,B=Qa(s,s.VERTEX_SHADER,y),I=Qa(s,s.FRAGMENT_SHADER,w);s.attachShader(M,B),s.attachShader(M,I),t.index0AttributeName!==void 0?s.bindAttribLocation(M,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(M,0,"position"),s.linkProgram(M);function P(E){if(i.debug.checkShaderErrors){const W=s.getProgramInfoLog(M).trim(),V=s.getShaderInfoLog(B).trim(),Z=s.getShaderInfoLog(I).trim();let ie=!0,X=!0;if(s.getProgramParameter(M,s.LINK_STATUS)===!1)if(ie=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,M,B,I);else{const ne=el(s,B,"vertex"),G=el(s,I,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(M,s.VALIDATE_STATUS)+`

Material Name: `+E.name+`
Material Type: `+E.type+`

Program Info Log: `+W+`
`+ne+`
`+G)}else W!==""?console.warn("THREE.WebGLProgram: Program Info Log:",W):(V===""||Z==="")&&(X=!1);X&&(E.diagnostics={runnable:ie,programLog:W,vertexShader:{log:V,prefix:p},fragmentShader:{log:Z,prefix:d}})}s.deleteShader(B),s.deleteShader(I),F=new Os(s,M),te=jp(s,M)}let F;this.getUniforms=function(){return F===void 0&&P(this),F};let te;this.getAttributes=function(){return te===void 0&&P(this),te};let v=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return v===!1&&(v=s.getProgramParameter(M,zp)),v},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(M),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=kp++,this.cacheKey=e,this.usedTimes=1,this.program=M,this.vertexShader=B,this.fragmentShader=I,this}let om=0;class am{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new lm(e),t.set(e,n)),n}}class lm{constructor(e){this.id=om++,this.code=e,this.usedTimes=0}}function cm(i,e,t,n,s,r,o){const a=new Qo,l=new am,c=new Set,u=[],_=s.logarithmicDepthBuffer,m=s.reverseDepthBuffer,h=s.vertexTextures;let g=s.precision;const M={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function p(v){return c.add(v),v===0?"uv":`uv${v}`}function d(v,E,W,V,Z){const ie=V.fog,X=Z.geometry,ne=v.isMeshStandardMaterial?V.environment:null,G=(v.isMeshStandardMaterial?t:e).get(v.envMap||ne),_e=G&&G.mapping===Js?G.image.height:null,ve=M[v.type];v.precision!==null&&(g=s.getMaxPrecision(v.precision),g!==v.precision&&console.warn("THREE.WebGLProgram.getParameters:",v.precision,"not supported, using",g,"instead."));const ye=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,He=ye!==void 0?ye.length:0;let Be=0;X.morphAttributes.position!==void 0&&(Be=1),X.morphAttributes.normal!==void 0&&(Be=2),X.morphAttributes.color!==void 0&&(Be=3);let Y,re,Me,Se;if(ve){const mt=jt[ve];Y=mt.vertexShader,re=mt.fragmentShader}else Y=v.vertexShader,re=v.fragmentShader,l.update(v),Me=l.getVertexShaderID(v),Se=l.getFragmentShaderID(v);const De=i.getRenderTarget(),Re=Z.isInstancedMesh===!0,Xe=Z.isBatchedMesh===!0,$e=!!v.map,ze=!!v.matcap,D=!!G,_t=!!v.aoMap,ke=!!v.lightMap,Ye=!!v.bumpMap,Ce=!!v.normalMap,Qe=!!v.displacementMap,Pe=!!v.emissiveMap,A=!!v.metalnessMap,x=!!v.roughnessMap,z=v.anisotropy>0,K=v.clearcoat>0,J=v.dispersion>0,j=v.iridescence>0,Ee=v.sheen>0,ue=v.transmission>0,pe=z&&!!v.anisotropyMap,qe=K&&!!v.clearcoatMap,se=K&&!!v.clearcoatNormalMap,xe=K&&!!v.clearcoatRoughnessMap,Ae=j&&!!v.iridescenceMap,we=j&&!!v.iridescenceThicknessMap,fe=Ee&&!!v.sheenColorMap,Oe=Ee&&!!v.sheenRoughnessMap,Ie=!!v.specularMap,Ke=!!v.specularColorMap,N=!!v.specularIntensityMap,ce=ue&&!!v.transmissionMap,H=ue&&!!v.thicknessMap,Q=!!v.gradientMap,me=!!v.alphaMap,ge=v.alphaTest>0,Ge=!!v.alphaHash,it=!!v.extensions;let pt=Tn;v.toneMapped&&(De===null||De.isXRRenderTarget===!0)&&(pt=i.toneMapping);const Ve={shaderID:ve,shaderType:v.type,shaderName:v.name,vertexShader:Y,fragmentShader:re,defines:v.defines,customVertexShaderID:Me,customFragmentShaderID:Se,isRawShaderMaterial:v.isRawShaderMaterial===!0,glslVersion:v.glslVersion,precision:g,batching:Xe,batchingColor:Xe&&Z._colorsTexture!==null,instancing:Re,instancingColor:Re&&Z.instanceColor!==null,instancingMorph:Re&&Z.morphTexture!==null,supportsVertexTextures:h,outputColorSpace:De===null?i.outputColorSpace:De.isXRRenderTarget===!0?De.texture.colorSpace:Rn,alphaToCoverage:!!v.alphaToCoverage,map:$e,matcap:ze,envMap:D,envMapMode:D&&G.mapping,envMapCubeUVHeight:_e,aoMap:_t,lightMap:ke,bumpMap:Ye,normalMap:Ce,displacementMap:h&&Qe,emissiveMap:Pe,normalMapObjectSpace:Ce&&v.normalMapType===pu,normalMapTangentSpace:Ce&&v.normalMapType===Zl,metalnessMap:A,roughnessMap:x,anisotropy:z,anisotropyMap:pe,clearcoat:K,clearcoatMap:qe,clearcoatNormalMap:se,clearcoatRoughnessMap:xe,dispersion:J,iridescence:j,iridescenceMap:Ae,iridescenceThicknessMap:we,sheen:Ee,sheenColorMap:fe,sheenRoughnessMap:Oe,specularMap:Ie,specularColorMap:Ke,specularIntensityMap:N,transmission:ue,transmissionMap:ce,thicknessMap:H,gradientMap:Q,opaque:v.transparent===!1&&v.blending===_i&&v.alphaToCoverage===!1,alphaMap:me,alphaTest:ge,alphaHash:Ge,combine:v.combine,mapUv:$e&&p(v.map.channel),aoMapUv:_t&&p(v.aoMap.channel),lightMapUv:ke&&p(v.lightMap.channel),bumpMapUv:Ye&&p(v.bumpMap.channel),normalMapUv:Ce&&p(v.normalMap.channel),displacementMapUv:Qe&&p(v.displacementMap.channel),emissiveMapUv:Pe&&p(v.emissiveMap.channel),metalnessMapUv:A&&p(v.metalnessMap.channel),roughnessMapUv:x&&p(v.roughnessMap.channel),anisotropyMapUv:pe&&p(v.anisotropyMap.channel),clearcoatMapUv:qe&&p(v.clearcoatMap.channel),clearcoatNormalMapUv:se&&p(v.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:xe&&p(v.clearcoatRoughnessMap.channel),iridescenceMapUv:Ae&&p(v.iridescenceMap.channel),iridescenceThicknessMapUv:we&&p(v.iridescenceThicknessMap.channel),sheenColorMapUv:fe&&p(v.sheenColorMap.channel),sheenRoughnessMapUv:Oe&&p(v.sheenRoughnessMap.channel),specularMapUv:Ie&&p(v.specularMap.channel),specularColorMapUv:Ke&&p(v.specularColorMap.channel),specularIntensityMapUv:N&&p(v.specularIntensityMap.channel),transmissionMapUv:ce&&p(v.transmissionMap.channel),thicknessMapUv:H&&p(v.thicknessMap.channel),alphaMapUv:me&&p(v.alphaMap.channel),vertexTangents:!!X.attributes.tangent&&(Ce||z),vertexColors:v.vertexColors,vertexAlphas:v.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,pointsUvs:Z.isPoints===!0&&!!X.attributes.uv&&($e||me),fog:!!ie,useFog:v.fog===!0,fogExp2:!!ie&&ie.isFogExp2,flatShading:v.flatShading===!0,sizeAttenuation:v.sizeAttenuation===!0,logarithmicDepthBuffer:_,reverseDepthBuffer:m,skinning:Z.isSkinnedMesh===!0,morphTargets:X.morphAttributes.position!==void 0,morphNormals:X.morphAttributes.normal!==void 0,morphColors:X.morphAttributes.color!==void 0,morphTargetsCount:He,morphTextureStride:Be,numDirLights:E.directional.length,numPointLights:E.point.length,numSpotLights:E.spot.length,numSpotLightMaps:E.spotLightMap.length,numRectAreaLights:E.rectArea.length,numHemiLights:E.hemi.length,numDirLightShadows:E.directionalShadowMap.length,numPointLightShadows:E.pointShadowMap.length,numSpotLightShadows:E.spotShadowMap.length,numSpotLightShadowsWithMaps:E.numSpotLightShadowsWithMaps,numLightProbes:E.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:v.dithering,shadowMapEnabled:i.shadowMap.enabled&&W.length>0,shadowMapType:i.shadowMap.type,toneMapping:pt,decodeVideoTexture:$e&&v.map.isVideoTexture===!0&&Je.getTransfer(v.map.colorSpace)===nt,premultipliedAlpha:v.premultipliedAlpha,doubleSided:v.side===rn,flipSided:v.side===Et,useDepthPacking:v.depthPacking>=0,depthPacking:v.depthPacking||0,index0AttributeName:v.index0AttributeName,extensionClipCullDistance:it&&v.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(it&&v.extensions.multiDraw===!0||Xe)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:v.customProgramCacheKey()};return Ve.vertexUv1s=c.has(1),Ve.vertexUv2s=c.has(2),Ve.vertexUv3s=c.has(3),c.clear(),Ve}function b(v){const E=[];if(v.shaderID?E.push(v.shaderID):(E.push(v.customVertexShaderID),E.push(v.customFragmentShaderID)),v.defines!==void 0)for(const W in v.defines)E.push(W),E.push(v.defines[W]);return v.isRawShaderMaterial===!1&&(y(E,v),w(E,v),E.push(i.outputColorSpace)),E.push(v.customProgramCacheKey),E.join()}function y(v,E){v.push(E.precision),v.push(E.outputColorSpace),v.push(E.envMapMode),v.push(E.envMapCubeUVHeight),v.push(E.mapUv),v.push(E.alphaMapUv),v.push(E.lightMapUv),v.push(E.aoMapUv),v.push(E.bumpMapUv),v.push(E.normalMapUv),v.push(E.displacementMapUv),v.push(E.emissiveMapUv),v.push(E.metalnessMapUv),v.push(E.roughnessMapUv),v.push(E.anisotropyMapUv),v.push(E.clearcoatMapUv),v.push(E.clearcoatNormalMapUv),v.push(E.clearcoatRoughnessMapUv),v.push(E.iridescenceMapUv),v.push(E.iridescenceThicknessMapUv),v.push(E.sheenColorMapUv),v.push(E.sheenRoughnessMapUv),v.push(E.specularMapUv),v.push(E.specularColorMapUv),v.push(E.specularIntensityMapUv),v.push(E.transmissionMapUv),v.push(E.thicknessMapUv),v.push(E.combine),v.push(E.fogExp2),v.push(E.sizeAttenuation),v.push(E.morphTargetsCount),v.push(E.morphAttributeCount),v.push(E.numDirLights),v.push(E.numPointLights),v.push(E.numSpotLights),v.push(E.numSpotLightMaps),v.push(E.numHemiLights),v.push(E.numRectAreaLights),v.push(E.numDirLightShadows),v.push(E.numPointLightShadows),v.push(E.numSpotLightShadows),v.push(E.numSpotLightShadowsWithMaps),v.push(E.numLightProbes),v.push(E.shadowMapType),v.push(E.toneMapping),v.push(E.numClippingPlanes),v.push(E.numClipIntersection),v.push(E.depthPacking)}function w(v,E){a.disableAll(),E.supportsVertexTextures&&a.enable(0),E.instancing&&a.enable(1),E.instancingColor&&a.enable(2),E.instancingMorph&&a.enable(3),E.matcap&&a.enable(4),E.envMap&&a.enable(5),E.normalMapObjectSpace&&a.enable(6),E.normalMapTangentSpace&&a.enable(7),E.clearcoat&&a.enable(8),E.iridescence&&a.enable(9),E.alphaTest&&a.enable(10),E.vertexColors&&a.enable(11),E.vertexAlphas&&a.enable(12),E.vertexUv1s&&a.enable(13),E.vertexUv2s&&a.enable(14),E.vertexUv3s&&a.enable(15),E.vertexTangents&&a.enable(16),E.anisotropy&&a.enable(17),E.alphaHash&&a.enable(18),E.batching&&a.enable(19),E.dispersion&&a.enable(20),E.batchingColor&&a.enable(21),v.push(a.mask),a.disableAll(),E.fog&&a.enable(0),E.useFog&&a.enable(1),E.flatShading&&a.enable(2),E.logarithmicDepthBuffer&&a.enable(3),E.reverseDepthBuffer&&a.enable(4),E.skinning&&a.enable(5),E.morphTargets&&a.enable(6),E.morphNormals&&a.enable(7),E.morphColors&&a.enable(8),E.premultipliedAlpha&&a.enable(9),E.shadowMapEnabled&&a.enable(10),E.doubleSided&&a.enable(11),E.flipSided&&a.enable(12),E.useDepthPacking&&a.enable(13),E.dithering&&a.enable(14),E.transmission&&a.enable(15),E.sheen&&a.enable(16),E.opaque&&a.enable(17),E.pointsUvs&&a.enable(18),E.decodeVideoTexture&&a.enable(19),E.alphaToCoverage&&a.enable(20),v.push(a.mask)}function B(v){const E=M[v.type];let W;if(E){const V=jt[E];W=Xu.clone(V.uniforms)}else W=v.uniforms;return W}function I(v,E){let W;for(let V=0,Z=u.length;V<Z;V++){const ie=u[V];if(ie.cacheKey===E){W=ie,++W.usedTimes;break}}return W===void 0&&(W=new rm(i,E,v,r),u.push(W)),W}function P(v){if(--v.usedTimes===0){const E=u.indexOf(v);u[E]=u[u.length-1],u.pop(),v.destroy()}}function F(v){l.remove(v)}function te(){l.dispose()}return{getParameters:d,getProgramCacheKey:b,getUniforms:B,acquireProgram:I,releaseProgram:P,releaseShaderCache:F,programs:u,dispose:te}}function um(){let i=new WeakMap;function e(o){return i.has(o)}function t(o){let a=i.get(o);return a===void 0&&(a={},i.set(o,a)),a}function n(o){i.delete(o)}function s(o,a,l){i.get(o)[a]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function hm(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function rl(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function ol(){const i=[];let e=0;const t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(_,m,h,g,M,p){let d=i[e];return d===void 0?(d={id:_.id,object:_,geometry:m,material:h,groupOrder:g,renderOrder:_.renderOrder,z:M,group:p},i[e]=d):(d.id=_.id,d.object=_,d.geometry=m,d.material=h,d.groupOrder=g,d.renderOrder=_.renderOrder,d.z=M,d.group=p),e++,d}function a(_,m,h,g,M,p){const d=o(_,m,h,g,M,p);h.transmission>0?n.push(d):h.transparent===!0?s.push(d):t.push(d)}function l(_,m,h,g,M,p){const d=o(_,m,h,g,M,p);h.transmission>0?n.unshift(d):h.transparent===!0?s.unshift(d):t.unshift(d)}function c(_,m){t.length>1&&t.sort(_||hm),n.length>1&&n.sort(m||rl),s.length>1&&s.sort(m||rl)}function u(){for(let _=e,m=i.length;_<m;_++){const h=i[_];if(h.id===null)break;h.id=null,h.object=null,h.geometry=null,h.material=null,h.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:l,finish:u,sort:c}}function dm(){let i=new WeakMap;function e(n,s){const r=i.get(n);let o;return r===void 0?(o=new ol,i.set(n,[o])):s>=r.length?(o=new ol,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function fm(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new O,color:new We};break;case"SpotLight":t={position:new O,direction:new O,color:new We,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new O,color:new We,distance:0,decay:0};break;case"HemisphereLight":t={direction:new O,skyColor:new We,groundColor:new We};break;case"RectAreaLight":t={color:new We,position:new O,halfWidth:new O,halfHeight:new O};break}return i[e.id]=t,t}}}function pm(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}let mm=0;function _m(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function gm(i){const e=new fm,t=pm(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new O);const s=new O,r=new tt,o=new tt;function a(c){let u=0,_=0,m=0;for(let te=0;te<9;te++)n.probe[te].set(0,0,0);let h=0,g=0,M=0,p=0,d=0,b=0,y=0,w=0,B=0,I=0,P=0;c.sort(_m);for(let te=0,v=c.length;te<v;te++){const E=c[te],W=E.color,V=E.intensity,Z=E.distance,ie=E.shadow&&E.shadow.map?E.shadow.map.texture:null;if(E.isAmbientLight)u+=W.r*V,_+=W.g*V,m+=W.b*V;else if(E.isLightProbe){for(let X=0;X<9;X++)n.probe[X].addScaledVector(E.sh.coefficients[X],V);P++}else if(E.isDirectionalLight){const X=e.get(E);if(X.color.copy(E.color).multiplyScalar(E.intensity),E.castShadow){const ne=E.shadow,G=t.get(E);G.shadowIntensity=ne.intensity,G.shadowBias=ne.bias,G.shadowNormalBias=ne.normalBias,G.shadowRadius=ne.radius,G.shadowMapSize=ne.mapSize,n.directionalShadow[h]=G,n.directionalShadowMap[h]=ie,n.directionalShadowMatrix[h]=E.shadow.matrix,b++}n.directional[h]=X,h++}else if(E.isSpotLight){const X=e.get(E);X.position.setFromMatrixPosition(E.matrixWorld),X.color.copy(W).multiplyScalar(V),X.distance=Z,X.coneCos=Math.cos(E.angle),X.penumbraCos=Math.cos(E.angle*(1-E.penumbra)),X.decay=E.decay,n.spot[M]=X;const ne=E.shadow;if(E.map&&(n.spotLightMap[B]=E.map,B++,ne.updateMatrices(E),E.castShadow&&I++),n.spotLightMatrix[M]=ne.matrix,E.castShadow){const G=t.get(E);G.shadowIntensity=ne.intensity,G.shadowBias=ne.bias,G.shadowNormalBias=ne.normalBias,G.shadowRadius=ne.radius,G.shadowMapSize=ne.mapSize,n.spotShadow[M]=G,n.spotShadowMap[M]=ie,w++}M++}else if(E.isRectAreaLight){const X=e.get(E);X.color.copy(W).multiplyScalar(V),X.halfWidth.set(E.width*.5,0,0),X.halfHeight.set(0,E.height*.5,0),n.rectArea[p]=X,p++}else if(E.isPointLight){const X=e.get(E);if(X.color.copy(E.color).multiplyScalar(E.intensity),X.distance=E.distance,X.decay=E.decay,E.castShadow){const ne=E.shadow,G=t.get(E);G.shadowIntensity=ne.intensity,G.shadowBias=ne.bias,G.shadowNormalBias=ne.normalBias,G.shadowRadius=ne.radius,G.shadowMapSize=ne.mapSize,G.shadowCameraNear=ne.camera.near,G.shadowCameraFar=ne.camera.far,n.pointShadow[g]=G,n.pointShadowMap[g]=ie,n.pointShadowMatrix[g]=E.shadow.matrix,y++}n.point[g]=X,g++}else if(E.isHemisphereLight){const X=e.get(E);X.skyColor.copy(E.color).multiplyScalar(V),X.groundColor.copy(E.groundColor).multiplyScalar(V),n.hemi[d]=X,d++}}p>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=de.LTC_FLOAT_1,n.rectAreaLTC2=de.LTC_FLOAT_2):(n.rectAreaLTC1=de.LTC_HALF_1,n.rectAreaLTC2=de.LTC_HALF_2)),n.ambient[0]=u,n.ambient[1]=_,n.ambient[2]=m;const F=n.hash;(F.directionalLength!==h||F.pointLength!==g||F.spotLength!==M||F.rectAreaLength!==p||F.hemiLength!==d||F.numDirectionalShadows!==b||F.numPointShadows!==y||F.numSpotShadows!==w||F.numSpotMaps!==B||F.numLightProbes!==P)&&(n.directional.length=h,n.spot.length=M,n.rectArea.length=p,n.point.length=g,n.hemi.length=d,n.directionalShadow.length=b,n.directionalShadowMap.length=b,n.pointShadow.length=y,n.pointShadowMap.length=y,n.spotShadow.length=w,n.spotShadowMap.length=w,n.directionalShadowMatrix.length=b,n.pointShadowMatrix.length=y,n.spotLightMatrix.length=w+B-I,n.spotLightMap.length=B,n.numSpotLightShadowsWithMaps=I,n.numLightProbes=P,F.directionalLength=h,F.pointLength=g,F.spotLength=M,F.rectAreaLength=p,F.hemiLength=d,F.numDirectionalShadows=b,F.numPointShadows=y,F.numSpotShadows=w,F.numSpotMaps=B,F.numLightProbes=P,n.version=mm++)}function l(c,u){let _=0,m=0,h=0,g=0,M=0;const p=u.matrixWorldInverse;for(let d=0,b=c.length;d<b;d++){const y=c[d];if(y.isDirectionalLight){const w=n.directional[_];w.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),w.direction.sub(s),w.direction.transformDirection(p),_++}else if(y.isSpotLight){const w=n.spot[h];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(p),w.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),w.direction.sub(s),w.direction.transformDirection(p),h++}else if(y.isRectAreaLight){const w=n.rectArea[g];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(p),o.identity(),r.copy(y.matrixWorld),r.premultiply(p),o.extractRotation(r),w.halfWidth.set(y.width*.5,0,0),w.halfHeight.set(0,y.height*.5,0),w.halfWidth.applyMatrix4(o),w.halfHeight.applyMatrix4(o),g++}else if(y.isPointLight){const w=n.point[m];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(p),m++}else if(y.isHemisphereLight){const w=n.hemi[M];w.direction.setFromMatrixPosition(y.matrixWorld),w.direction.transformDirection(p),M++}}}return{setup:a,setupView:l,state:n}}function al(i){const e=new gm(i),t=[],n=[];function s(u){c.camera=u,t.length=0,n.length=0}function r(u){t.push(u)}function o(u){n.push(u)}function a(){e.setup(t)}function l(u){e.setupView(t,u)}const c={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:s,state:c,setupLights:a,setupLightsView:l,pushLight:r,pushShadow:o}}function vm(i){let e=new WeakMap;function t(s,r=0){const o=e.get(s);let a;return o===void 0?(a=new al(i),e.set(s,[a])):r>=o.length?(a=new al(i),o.push(a)):a=o[r],a}function n(){e=new WeakMap}return{get:t,dispose:n}}class xm extends Yn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=du,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class Mm extends Yn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}const Sm=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,ym=`uniform sampler2D shadow_pass;
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
}`;function Em(i,e,t){let n=new ta;const s=new Le,r=new Le,o=new rt,a=new xm({depthPacking:fu}),l=new Mm,c={},u=t.maxTextureSize,_={[An]:Et,[Et]:An,[rn]:rn},m=new wn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Le},radius:{value:4}},vertexShader:Sm,fragmentShader:ym}),h=m.clone();h.defines.HORIZONTAL_PASS=1;const g=new Pt;g.setAttribute("position",new $t(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const M=new Ft(g,m),p=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Bl;let d=this.type;this.render=function(I,P,F){if(p.enabled===!1||p.autoUpdate===!1&&p.needsUpdate===!1||I.length===0)return;const te=i.getRenderTarget(),v=i.getActiveCubeFace(),E=i.getActiveMipmapLevel(),W=i.state;W.setBlending(bn),W.buffers.color.setClear(1,1,1,1),W.buffers.depth.setTest(!0),W.setScissorTest(!1);const V=d!==sn&&this.type===sn,Z=d===sn&&this.type!==sn;for(let ie=0,X=I.length;ie<X;ie++){const ne=I[ie],G=ne.shadow;if(G===void 0){console.warn("THREE.WebGLShadowMap:",ne,"has no shadow.");continue}if(G.autoUpdate===!1&&G.needsUpdate===!1)continue;s.copy(G.mapSize);const _e=G.getFrameExtents();if(s.multiply(_e),r.copy(G.mapSize),(s.x>u||s.y>u)&&(s.x>u&&(r.x=Math.floor(u/_e.x),s.x=r.x*_e.x,G.mapSize.x=r.x),s.y>u&&(r.y=Math.floor(u/_e.y),s.y=r.y*_e.y,G.mapSize.y=r.y)),G.map===null||V===!0||Z===!0){const ye=this.type!==sn?{minFilter:Ut,magFilter:Ut}:{};G.map!==null&&G.map.dispose(),G.map=new Gn(s.x,s.y,ye),G.map.texture.name=ne.name+".shadowMap",G.camera.updateProjectionMatrix()}i.setRenderTarget(G.map),i.clear();const ve=G.getViewportCount();for(let ye=0;ye<ve;ye++){const He=G.getViewport(ye);o.set(r.x*He.x,r.y*He.y,r.x*He.z,r.y*He.w),W.viewport(o),G.updateMatrices(ne,ye),n=G.getFrustum(),w(P,F,G.camera,ne,this.type)}G.isPointLightShadow!==!0&&this.type===sn&&b(G,F),G.needsUpdate=!1}d=this.type,p.needsUpdate=!1,i.setRenderTarget(te,v,E)};function b(I,P){const F=e.update(M);m.defines.VSM_SAMPLES!==I.blurSamples&&(m.defines.VSM_SAMPLES=I.blurSamples,h.defines.VSM_SAMPLES=I.blurSamples,m.needsUpdate=!0,h.needsUpdate=!0),I.mapPass===null&&(I.mapPass=new Gn(s.x,s.y)),m.uniforms.shadow_pass.value=I.map.texture,m.uniforms.resolution.value=I.mapSize,m.uniforms.radius.value=I.radius,i.setRenderTarget(I.mapPass),i.clear(),i.renderBufferDirect(P,null,F,m,M,null),h.uniforms.shadow_pass.value=I.mapPass.texture,h.uniforms.resolution.value=I.mapSize,h.uniforms.radius.value=I.radius,i.setRenderTarget(I.map),i.clear(),i.renderBufferDirect(P,null,F,h,M,null)}function y(I,P,F,te){let v=null;const E=F.isPointLight===!0?I.customDistanceMaterial:I.customDepthMaterial;if(E!==void 0)v=E;else if(v=F.isPointLight===!0?l:a,i.localClippingEnabled&&P.clipShadows===!0&&Array.isArray(P.clippingPlanes)&&P.clippingPlanes.length!==0||P.displacementMap&&P.displacementScale!==0||P.alphaMap&&P.alphaTest>0||P.map&&P.alphaTest>0){const W=v.uuid,V=P.uuid;let Z=c[W];Z===void 0&&(Z={},c[W]=Z);let ie=Z[V];ie===void 0&&(ie=v.clone(),Z[V]=ie,P.addEventListener("dispose",B)),v=ie}if(v.visible=P.visible,v.wireframe=P.wireframe,te===sn?v.side=P.shadowSide!==null?P.shadowSide:P.side:v.side=P.shadowSide!==null?P.shadowSide:_[P.side],v.alphaMap=P.alphaMap,v.alphaTest=P.alphaTest,v.map=P.map,v.clipShadows=P.clipShadows,v.clippingPlanes=P.clippingPlanes,v.clipIntersection=P.clipIntersection,v.displacementMap=P.displacementMap,v.displacementScale=P.displacementScale,v.displacementBias=P.displacementBias,v.wireframeLinewidth=P.wireframeLinewidth,v.linewidth=P.linewidth,F.isPointLight===!0&&v.isMeshDistanceMaterial===!0){const W=i.properties.get(v);W.light=F}return v}function w(I,P,F,te,v){if(I.visible===!1)return;if(I.layers.test(P.layers)&&(I.isMesh||I.isLine||I.isPoints)&&(I.castShadow||I.receiveShadow&&v===sn)&&(!I.frustumCulled||n.intersectsObject(I))){I.modelViewMatrix.multiplyMatrices(F.matrixWorldInverse,I.matrixWorld);const V=e.update(I),Z=I.material;if(Array.isArray(Z)){const ie=V.groups;for(let X=0,ne=ie.length;X<ne;X++){const G=ie[X],_e=Z[G.materialIndex];if(_e&&_e.visible){const ve=y(I,_e,te,v);I.onBeforeShadow(i,I,P,F,V,ve,G),i.renderBufferDirect(F,null,V,ve,I,G),I.onAfterShadow(i,I,P,F,V,ve,G)}}}else if(Z.visible){const ie=y(I,Z,te,v);I.onBeforeShadow(i,I,P,F,V,ie,null),i.renderBufferDirect(F,null,V,ie,I,null),I.onAfterShadow(i,I,P,F,V,ie,null)}}const W=I.children;for(let V=0,Z=W.length;V<Z;V++)w(W[V],P,F,te,v)}function B(I){I.target.removeEventListener("dispose",B);for(const F in c){const te=c[F],v=I.target.uuid;v in te&&(te[v].dispose(),delete te[v])}}}const bm={[to]:no,[io]:oo,[so]:ao,[Si]:ro,[no]:to,[oo]:io,[ao]:so,[ro]:Si};function Tm(i){function e(){let N=!1;const ce=new rt;let H=null;const Q=new rt(0,0,0,0);return{setMask:function(me){H!==me&&!N&&(i.colorMask(me,me,me,me),H=me)},setLocked:function(me){N=me},setClear:function(me,ge,Ge,it,pt){pt===!0&&(me*=it,ge*=it,Ge*=it),ce.set(me,ge,Ge,it),Q.equals(ce)===!1&&(i.clearColor(me,ge,Ge,it),Q.copy(ce))},reset:function(){N=!1,H=null,Q.set(-1,0,0,0)}}}function t(){let N=!1,ce=!1,H=null,Q=null,me=null;return{setReversed:function(ge){ce=ge},setTest:function(ge){ge?Me(i.DEPTH_TEST):Se(i.DEPTH_TEST)},setMask:function(ge){H!==ge&&!N&&(i.depthMask(ge),H=ge)},setFunc:function(ge){if(ce&&(ge=bm[ge]),Q!==ge){switch(ge){case to:i.depthFunc(i.NEVER);break;case no:i.depthFunc(i.ALWAYS);break;case io:i.depthFunc(i.LESS);break;case Si:i.depthFunc(i.LEQUAL);break;case so:i.depthFunc(i.EQUAL);break;case ro:i.depthFunc(i.GEQUAL);break;case oo:i.depthFunc(i.GREATER);break;case ao:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}Q=ge}},setLocked:function(ge){N=ge},setClear:function(ge){me!==ge&&(i.clearDepth(ge),me=ge)},reset:function(){N=!1,H=null,Q=null,me=null}}}function n(){let N=!1,ce=null,H=null,Q=null,me=null,ge=null,Ge=null,it=null,pt=null;return{setTest:function(Ve){N||(Ve?Me(i.STENCIL_TEST):Se(i.STENCIL_TEST))},setMask:function(Ve){ce!==Ve&&!N&&(i.stencilMask(Ve),ce=Ve)},setFunc:function(Ve,mt,Lt){(H!==Ve||Q!==mt||me!==Lt)&&(i.stencilFunc(Ve,mt,Lt),H=Ve,Q=mt,me=Lt)},setOp:function(Ve,mt,Lt){(ge!==Ve||Ge!==mt||it!==Lt)&&(i.stencilOp(Ve,mt,Lt),ge=Ve,Ge=mt,it=Lt)},setLocked:function(Ve){N=Ve},setClear:function(Ve){pt!==Ve&&(i.clearStencil(Ve),pt=Ve)},reset:function(){N=!1,ce=null,H=null,Q=null,me=null,ge=null,Ge=null,it=null,pt=null}}}const s=new e,r=new t,o=new n,a=new WeakMap,l=new WeakMap;let c={},u={},_=new WeakMap,m=[],h=null,g=!1,M=null,p=null,d=null,b=null,y=null,w=null,B=null,I=new We(0,0,0),P=0,F=!1,te=null,v=null,E=null,W=null,V=null;const Z=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let ie=!1,X=0;const ne=i.getParameter(i.VERSION);ne.indexOf("WebGL")!==-1?(X=parseFloat(/^WebGL (\d)/.exec(ne)[1]),ie=X>=1):ne.indexOf("OpenGL ES")!==-1&&(X=parseFloat(/^OpenGL ES (\d)/.exec(ne)[1]),ie=X>=2);let G=null,_e={};const ve=i.getParameter(i.SCISSOR_BOX),ye=i.getParameter(i.VIEWPORT),He=new rt().fromArray(ve),Be=new rt().fromArray(ye);function Y(N,ce,H,Q){const me=new Uint8Array(4),ge=i.createTexture();i.bindTexture(N,ge),i.texParameteri(N,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(N,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ge=0;Ge<H;Ge++)N===i.TEXTURE_3D||N===i.TEXTURE_2D_ARRAY?i.texImage3D(ce,0,i.RGBA,1,1,Q,0,i.RGBA,i.UNSIGNED_BYTE,me):i.texImage2D(ce+Ge,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,me);return ge}const re={};re[i.TEXTURE_2D]=Y(i.TEXTURE_2D,i.TEXTURE_2D,1),re[i.TEXTURE_CUBE_MAP]=Y(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),re[i.TEXTURE_2D_ARRAY]=Y(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),re[i.TEXTURE_3D]=Y(i.TEXTURE_3D,i.TEXTURE_3D,1,1),s.setClear(0,0,0,1),r.setClear(1),o.setClear(0),Me(i.DEPTH_TEST),r.setFunc(Si),ke(!1),Ye(ma),Me(i.CULL_FACE),D(bn);function Me(N){c[N]!==!0&&(i.enable(N),c[N]=!0)}function Se(N){c[N]!==!1&&(i.disable(N),c[N]=!1)}function De(N,ce){return u[N]!==ce?(i.bindFramebuffer(N,ce),u[N]=ce,N===i.DRAW_FRAMEBUFFER&&(u[i.FRAMEBUFFER]=ce),N===i.FRAMEBUFFER&&(u[i.DRAW_FRAMEBUFFER]=ce),!0):!1}function Re(N,ce){let H=m,Q=!1;if(N){H=_.get(ce),H===void 0&&(H=[],_.set(ce,H));const me=N.textures;if(H.length!==me.length||H[0]!==i.COLOR_ATTACHMENT0){for(let ge=0,Ge=me.length;ge<Ge;ge++)H[ge]=i.COLOR_ATTACHMENT0+ge;H.length=me.length,Q=!0}}else H[0]!==i.BACK&&(H[0]=i.BACK,Q=!0);Q&&i.drawBuffers(H)}function Xe(N){return h!==N?(i.useProgram(N),h=N,!0):!1}const $e={[On]:i.FUNC_ADD,[zc]:i.FUNC_SUBTRACT,[kc]:i.FUNC_REVERSE_SUBTRACT};$e[Hc]=i.MIN,$e[Gc]=i.MAX;const ze={[Vc]:i.ZERO,[Wc]:i.ONE,[Xc]:i.SRC_COLOR,[Qr]:i.SRC_ALPHA,[Zc]:i.SRC_ALPHA_SATURATE,[Kc]:i.DST_COLOR,[qc]:i.DST_ALPHA,[Yc]:i.ONE_MINUS_SRC_COLOR,[eo]:i.ONE_MINUS_SRC_ALPHA,[$c]:i.ONE_MINUS_DST_COLOR,[jc]:i.ONE_MINUS_DST_ALPHA,[Jc]:i.CONSTANT_COLOR,[Qc]:i.ONE_MINUS_CONSTANT_COLOR,[eu]:i.CONSTANT_ALPHA,[tu]:i.ONE_MINUS_CONSTANT_ALPHA};function D(N,ce,H,Q,me,ge,Ge,it,pt,Ve){if(N===bn){g===!0&&(Se(i.BLEND),g=!1);return}if(g===!1&&(Me(i.BLEND),g=!0),N!==Bc){if(N!==M||Ve!==F){if((p!==On||y!==On)&&(i.blendEquation(i.FUNC_ADD),p=On,y=On),Ve)switch(N){case _i:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case _a:i.blendFunc(i.ONE,i.ONE);break;case ga:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case va:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}else switch(N){case _i:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case _a:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case ga:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case va:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}d=null,b=null,w=null,B=null,I.set(0,0,0),P=0,M=N,F=Ve}return}me=me||ce,ge=ge||H,Ge=Ge||Q,(ce!==p||me!==y)&&(i.blendEquationSeparate($e[ce],$e[me]),p=ce,y=me),(H!==d||Q!==b||ge!==w||Ge!==B)&&(i.blendFuncSeparate(ze[H],ze[Q],ze[ge],ze[Ge]),d=H,b=Q,w=ge,B=Ge),(it.equals(I)===!1||pt!==P)&&(i.blendColor(it.r,it.g,it.b,pt),I.copy(it),P=pt),M=N,F=!1}function _t(N,ce){N.side===rn?Se(i.CULL_FACE):Me(i.CULL_FACE);let H=N.side===Et;ce&&(H=!H),ke(H),N.blending===_i&&N.transparent===!1?D(bn):D(N.blending,N.blendEquation,N.blendSrc,N.blendDst,N.blendEquationAlpha,N.blendSrcAlpha,N.blendDstAlpha,N.blendColor,N.blendAlpha,N.premultipliedAlpha),r.setFunc(N.depthFunc),r.setTest(N.depthTest),r.setMask(N.depthWrite),s.setMask(N.colorWrite);const Q=N.stencilWrite;o.setTest(Q),Q&&(o.setMask(N.stencilWriteMask),o.setFunc(N.stencilFunc,N.stencilRef,N.stencilFuncMask),o.setOp(N.stencilFail,N.stencilZFail,N.stencilZPass)),Qe(N.polygonOffset,N.polygonOffsetFactor,N.polygonOffsetUnits),N.alphaToCoverage===!0?Me(i.SAMPLE_ALPHA_TO_COVERAGE):Se(i.SAMPLE_ALPHA_TO_COVERAGE)}function ke(N){te!==N&&(N?i.frontFace(i.CW):i.frontFace(i.CCW),te=N)}function Ye(N){N!==Uc?(Me(i.CULL_FACE),N!==v&&(N===ma?i.cullFace(i.BACK):N===Fc?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Se(i.CULL_FACE),v=N}function Ce(N){N!==E&&(ie&&i.lineWidth(N),E=N)}function Qe(N,ce,H){N?(Me(i.POLYGON_OFFSET_FILL),(W!==ce||V!==H)&&(i.polygonOffset(ce,H),W=ce,V=H)):Se(i.POLYGON_OFFSET_FILL)}function Pe(N){N?Me(i.SCISSOR_TEST):Se(i.SCISSOR_TEST)}function A(N){N===void 0&&(N=i.TEXTURE0+Z-1),G!==N&&(i.activeTexture(N),G=N)}function x(N,ce,H){H===void 0&&(G===null?H=i.TEXTURE0+Z-1:H=G);let Q=_e[H];Q===void 0&&(Q={type:void 0,texture:void 0},_e[H]=Q),(Q.type!==N||Q.texture!==ce)&&(G!==H&&(i.activeTexture(H),G=H),i.bindTexture(N,ce||re[N]),Q.type=N,Q.texture=ce)}function z(){const N=_e[G];N!==void 0&&N.type!==void 0&&(i.bindTexture(N.type,null),N.type=void 0,N.texture=void 0)}function K(){try{i.compressedTexImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function J(){try{i.compressedTexImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function j(){try{i.texSubImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Ee(){try{i.texSubImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function ue(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function pe(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function qe(){try{i.texStorage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function se(){try{i.texStorage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function xe(){try{i.texImage2D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Ae(){try{i.texImage3D.apply(i,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function we(N){He.equals(N)===!1&&(i.scissor(N.x,N.y,N.z,N.w),He.copy(N))}function fe(N){Be.equals(N)===!1&&(i.viewport(N.x,N.y,N.z,N.w),Be.copy(N))}function Oe(N,ce){let H=l.get(ce);H===void 0&&(H=new WeakMap,l.set(ce,H));let Q=H.get(N);Q===void 0&&(Q=i.getUniformBlockIndex(ce,N.name),H.set(N,Q))}function Ie(N,ce){const Q=l.get(ce).get(N);a.get(ce)!==Q&&(i.uniformBlockBinding(ce,Q,N.__bindingPointIndex),a.set(ce,Q))}function Ke(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),c={},G=null,_e={},u={},_=new WeakMap,m=[],h=null,g=!1,M=null,p=null,d=null,b=null,y=null,w=null,B=null,I=new We(0,0,0),P=0,F=!1,te=null,v=null,E=null,W=null,V=null,He.set(0,0,i.canvas.width,i.canvas.height),Be.set(0,0,i.canvas.width,i.canvas.height),s.reset(),r.reset(),o.reset()}return{buffers:{color:s,depth:r,stencil:o},enable:Me,disable:Se,bindFramebuffer:De,drawBuffers:Re,useProgram:Xe,setBlending:D,setMaterial:_t,setFlipSided:ke,setCullFace:Ye,setLineWidth:Ce,setPolygonOffset:Qe,setScissorTest:Pe,activeTexture:A,bindTexture:x,unbindTexture:z,compressedTexImage2D:K,compressedTexImage3D:J,texImage2D:xe,texImage3D:Ae,updateUBOMapping:Oe,uniformBlockBinding:Ie,texStorage2D:qe,texStorage3D:se,texSubImage2D:j,texSubImage3D:Ee,compressedTexSubImage2D:ue,compressedTexSubImage3D:pe,scissor:we,viewport:fe,reset:Ke}}function ll(i,e,t,n){const s=Am(n);switch(t){case Wl:return i*e;case Yl:return i*e;case ql:return i*e*2;case jl:return i*e/s.components*s.byteLength;case Ko:return i*e/s.components*s.byteLength;case Kl:return i*e*2/s.components*s.byteLength;case $o:return i*e*2/s.components*s.byteLength;case Xl:return i*e*3/s.components*s.byteLength;case Wt:return i*e*4/s.components*s.byteLength;case Zo:return i*e*4/s.components*s.byteLength;case Ps:case Ls:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Ds:case Is:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case po:case _o:return Math.max(i,16)*Math.max(e,8)/4;case fo:case mo:return Math.max(i,8)*Math.max(e,8)/2;case go:case vo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case xo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Mo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case So:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case yo:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case Eo:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case bo:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case To:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case Ao:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case wo:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case Ro:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case Co:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case Po:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case Lo:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case Do:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case Io:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case Ns:case No:case Uo:return Math.ceil(i/4)*Math.ceil(e/4)*16;case $l:case Fo:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Oo:case Bo:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function Am(i){switch(i){case cn:case Hl:return{byteLength:1,components:1};case Vi:case Gl:case Wi:return{byteLength:2,components:1};case qo:case jo:return{byteLength:2,components:4};case Hn:case Yo:case on:return{byteLength:4,components:1};case Vl:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}function wm(i,e,t,n,s,r,o){const a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Le,u=new WeakMap;let _;const m=new WeakMap;let h=!1;try{h=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(A,x){return h?new OffscreenCanvas(A,x):Ws("canvas")}function M(A,x,z){let K=1;const J=Pe(A);if((J.width>z||J.height>z)&&(K=z/Math.max(J.width,J.height)),K<1)if(typeof HTMLImageElement<"u"&&A instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&A instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&A instanceof ImageBitmap||typeof VideoFrame<"u"&&A instanceof VideoFrame){const j=Math.floor(K*J.width),Ee=Math.floor(K*J.height);_===void 0&&(_=g(j,Ee));const ue=x?g(j,Ee):_;return ue.width=j,ue.height=Ee,ue.getContext("2d").drawImage(A,0,0,j,Ee),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+J.width+"x"+J.height+") to ("+j+"x"+Ee+")."),ue}else return"data"in A&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+J.width+"x"+J.height+")."),A;return A}function p(A){return A.generateMipmaps&&A.minFilter!==Ut&&A.minFilter!==Gt}function d(A){i.generateMipmap(A)}function b(A,x,z,K,J=!1){if(A!==null){if(i[A]!==void 0)return i[A];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+A+"'")}let j=x;if(x===i.RED&&(z===i.FLOAT&&(j=i.R32F),z===i.HALF_FLOAT&&(j=i.R16F),z===i.UNSIGNED_BYTE&&(j=i.R8)),x===i.RED_INTEGER&&(z===i.UNSIGNED_BYTE&&(j=i.R8UI),z===i.UNSIGNED_SHORT&&(j=i.R16UI),z===i.UNSIGNED_INT&&(j=i.R32UI),z===i.BYTE&&(j=i.R8I),z===i.SHORT&&(j=i.R16I),z===i.INT&&(j=i.R32I)),x===i.RG&&(z===i.FLOAT&&(j=i.RG32F),z===i.HALF_FLOAT&&(j=i.RG16F),z===i.UNSIGNED_BYTE&&(j=i.RG8)),x===i.RG_INTEGER&&(z===i.UNSIGNED_BYTE&&(j=i.RG8UI),z===i.UNSIGNED_SHORT&&(j=i.RG16UI),z===i.UNSIGNED_INT&&(j=i.RG32UI),z===i.BYTE&&(j=i.RG8I),z===i.SHORT&&(j=i.RG16I),z===i.INT&&(j=i.RG32I)),x===i.RGB_INTEGER&&(z===i.UNSIGNED_BYTE&&(j=i.RGB8UI),z===i.UNSIGNED_SHORT&&(j=i.RGB16UI),z===i.UNSIGNED_INT&&(j=i.RGB32UI),z===i.BYTE&&(j=i.RGB8I),z===i.SHORT&&(j=i.RGB16I),z===i.INT&&(j=i.RGB32I)),x===i.RGBA_INTEGER&&(z===i.UNSIGNED_BYTE&&(j=i.RGBA8UI),z===i.UNSIGNED_SHORT&&(j=i.RGBA16UI),z===i.UNSIGNED_INT&&(j=i.RGBA32UI),z===i.BYTE&&(j=i.RGBA8I),z===i.SHORT&&(j=i.RGBA16I),z===i.INT&&(j=i.RGBA32I)),x===i.RGB&&z===i.UNSIGNED_INT_5_9_9_9_REV&&(j=i.RGB9_E5),x===i.RGBA){const Ee=J?ks:Je.getTransfer(K);z===i.FLOAT&&(j=i.RGBA32F),z===i.HALF_FLOAT&&(j=i.RGBA16F),z===i.UNSIGNED_BYTE&&(j=Ee===nt?i.SRGB8_ALPHA8:i.RGBA8),z===i.UNSIGNED_SHORT_4_4_4_4&&(j=i.RGBA4),z===i.UNSIGNED_SHORT_5_5_5_1&&(j=i.RGB5_A1)}return(j===i.R16F||j===i.R32F||j===i.RG16F||j===i.RG32F||j===i.RGBA16F||j===i.RGBA32F)&&e.get("EXT_color_buffer_float"),j}function y(A,x){let z;return A?x===null||x===Hn||x===bi?z=i.DEPTH24_STENCIL8:x===on?z=i.DEPTH32F_STENCIL8:x===Vi&&(z=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):x===null||x===Hn||x===bi?z=i.DEPTH_COMPONENT24:x===on?z=i.DEPTH_COMPONENT32F:x===Vi&&(z=i.DEPTH_COMPONENT16),z}function w(A,x){return p(A)===!0||A.isFramebufferTexture&&A.minFilter!==Ut&&A.minFilter!==Gt?Math.log2(Math.max(x.width,x.height))+1:A.mipmaps!==void 0&&A.mipmaps.length>0?A.mipmaps.length:A.isCompressedTexture&&Array.isArray(A.image)?x.mipmaps.length:1}function B(A){const x=A.target;x.removeEventListener("dispose",B),P(x),x.isVideoTexture&&u.delete(x)}function I(A){const x=A.target;x.removeEventListener("dispose",I),te(x)}function P(A){const x=n.get(A);if(x.__webglInit===void 0)return;const z=A.source,K=m.get(z);if(K){const J=K[x.__cacheKey];J.usedTimes--,J.usedTimes===0&&F(A),Object.keys(K).length===0&&m.delete(z)}n.remove(A)}function F(A){const x=n.get(A);i.deleteTexture(x.__webglTexture);const z=A.source,K=m.get(z);delete K[x.__cacheKey],o.memory.textures--}function te(A){const x=n.get(A);if(A.depthTexture&&A.depthTexture.dispose(),A.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(x.__webglFramebuffer[K]))for(let J=0;J<x.__webglFramebuffer[K].length;J++)i.deleteFramebuffer(x.__webglFramebuffer[K][J]);else i.deleteFramebuffer(x.__webglFramebuffer[K]);x.__webglDepthbuffer&&i.deleteRenderbuffer(x.__webglDepthbuffer[K])}else{if(Array.isArray(x.__webglFramebuffer))for(let K=0;K<x.__webglFramebuffer.length;K++)i.deleteFramebuffer(x.__webglFramebuffer[K]);else i.deleteFramebuffer(x.__webglFramebuffer);if(x.__webglDepthbuffer&&i.deleteRenderbuffer(x.__webglDepthbuffer),x.__webglMultisampledFramebuffer&&i.deleteFramebuffer(x.__webglMultisampledFramebuffer),x.__webglColorRenderbuffer)for(let K=0;K<x.__webglColorRenderbuffer.length;K++)x.__webglColorRenderbuffer[K]&&i.deleteRenderbuffer(x.__webglColorRenderbuffer[K]);x.__webglDepthRenderbuffer&&i.deleteRenderbuffer(x.__webglDepthRenderbuffer)}const z=A.textures;for(let K=0,J=z.length;K<J;K++){const j=n.get(z[K]);j.__webglTexture&&(i.deleteTexture(j.__webglTexture),o.memory.textures--),n.remove(z[K])}n.remove(A)}let v=0;function E(){v=0}function W(){const A=v;return A>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+A+" texture units while this GPU supports only "+s.maxTextures),v+=1,A}function V(A){const x=[];return x.push(A.wrapS),x.push(A.wrapT),x.push(A.wrapR||0),x.push(A.magFilter),x.push(A.minFilter),x.push(A.anisotropy),x.push(A.internalFormat),x.push(A.format),x.push(A.type),x.push(A.generateMipmaps),x.push(A.premultiplyAlpha),x.push(A.flipY),x.push(A.unpackAlignment),x.push(A.colorSpace),x.join()}function Z(A,x){const z=n.get(A);if(A.isVideoTexture&&Ce(A),A.isRenderTargetTexture===!1&&A.version>0&&z.__version!==A.version){const K=A.image;if(K===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(K.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{Be(z,A,x);return}}t.bindTexture(i.TEXTURE_2D,z.__webglTexture,i.TEXTURE0+x)}function ie(A,x){const z=n.get(A);if(A.version>0&&z.__version!==A.version){Be(z,A,x);return}t.bindTexture(i.TEXTURE_2D_ARRAY,z.__webglTexture,i.TEXTURE0+x)}function X(A,x){const z=n.get(A);if(A.version>0&&z.__version!==A.version){Be(z,A,x);return}t.bindTexture(i.TEXTURE_3D,z.__webglTexture,i.TEXTURE0+x)}function ne(A,x){const z=n.get(A);if(A.version>0&&z.__version!==A.version){Y(z,A,x);return}t.bindTexture(i.TEXTURE_CUBE_MAP,z.__webglTexture,i.TEXTURE0+x)}const G={[uo]:i.REPEAT,[zn]:i.CLAMP_TO_EDGE,[ho]:i.MIRRORED_REPEAT},_e={[Ut]:i.NEAREST,[hu]:i.NEAREST_MIPMAP_NEAREST,[is]:i.NEAREST_MIPMAP_LINEAR,[Gt]:i.LINEAR,[fr]:i.LINEAR_MIPMAP_NEAREST,[kn]:i.LINEAR_MIPMAP_LINEAR},ve={[mu]:i.NEVER,[Su]:i.ALWAYS,[_u]:i.LESS,[Jl]:i.LEQUAL,[gu]:i.EQUAL,[Mu]:i.GEQUAL,[vu]:i.GREATER,[xu]:i.NOTEQUAL};function ye(A,x){if(x.type===on&&e.has("OES_texture_float_linear")===!1&&(x.magFilter===Gt||x.magFilter===fr||x.magFilter===is||x.magFilter===kn||x.minFilter===Gt||x.minFilter===fr||x.minFilter===is||x.minFilter===kn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(A,i.TEXTURE_WRAP_S,G[x.wrapS]),i.texParameteri(A,i.TEXTURE_WRAP_T,G[x.wrapT]),(A===i.TEXTURE_3D||A===i.TEXTURE_2D_ARRAY)&&i.texParameteri(A,i.TEXTURE_WRAP_R,G[x.wrapR]),i.texParameteri(A,i.TEXTURE_MAG_FILTER,_e[x.magFilter]),i.texParameteri(A,i.TEXTURE_MIN_FILTER,_e[x.minFilter]),x.compareFunction&&(i.texParameteri(A,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(A,i.TEXTURE_COMPARE_FUNC,ve[x.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(x.magFilter===Ut||x.minFilter!==is&&x.minFilter!==kn||x.type===on&&e.has("OES_texture_float_linear")===!1)return;if(x.anisotropy>1||n.get(x).__currentAnisotropy){const z=e.get("EXT_texture_filter_anisotropic");i.texParameterf(A,z.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(x.anisotropy,s.getMaxAnisotropy())),n.get(x).__currentAnisotropy=x.anisotropy}}}function He(A,x){let z=!1;A.__webglInit===void 0&&(A.__webglInit=!0,x.addEventListener("dispose",B));const K=x.source;let J=m.get(K);J===void 0&&(J={},m.set(K,J));const j=V(x);if(j!==A.__cacheKey){J[j]===void 0&&(J[j]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,z=!0),J[j].usedTimes++;const Ee=J[A.__cacheKey];Ee!==void 0&&(J[A.__cacheKey].usedTimes--,Ee.usedTimes===0&&F(x)),A.__cacheKey=j,A.__webglTexture=J[j].texture}return z}function Be(A,x,z){let K=i.TEXTURE_2D;(x.isDataArrayTexture||x.isCompressedArrayTexture)&&(K=i.TEXTURE_2D_ARRAY),x.isData3DTexture&&(K=i.TEXTURE_3D);const J=He(A,x),j=x.source;t.bindTexture(K,A.__webglTexture,i.TEXTURE0+z);const Ee=n.get(j);if(j.version!==Ee.__version||J===!0){t.activeTexture(i.TEXTURE0+z);const ue=Je.getPrimaries(Je.workingColorSpace),pe=x.colorSpace===Sn?null:Je.getPrimaries(x.colorSpace),qe=x.colorSpace===Sn||ue===pe?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,qe);let se=M(x.image,!1,s.maxTextureSize);se=Qe(x,se);const xe=r.convert(x.format,x.colorSpace),Ae=r.convert(x.type);let we=b(x.internalFormat,xe,Ae,x.colorSpace,x.isVideoTexture);ye(K,x);let fe;const Oe=x.mipmaps,Ie=x.isVideoTexture!==!0,Ke=Ee.__version===void 0||J===!0,N=j.dataReady,ce=w(x,se);if(x.isDepthTexture)we=y(x.format===Ti,x.type),Ke&&(Ie?t.texStorage2D(i.TEXTURE_2D,1,we,se.width,se.height):t.texImage2D(i.TEXTURE_2D,0,we,se.width,se.height,0,xe,Ae,null));else if(x.isDataTexture)if(Oe.length>0){Ie&&Ke&&t.texStorage2D(i.TEXTURE_2D,ce,we,Oe[0].width,Oe[0].height);for(let H=0,Q=Oe.length;H<Q;H++)fe=Oe[H],Ie?N&&t.texSubImage2D(i.TEXTURE_2D,H,0,0,fe.width,fe.height,xe,Ae,fe.data):t.texImage2D(i.TEXTURE_2D,H,we,fe.width,fe.height,0,xe,Ae,fe.data);x.generateMipmaps=!1}else Ie?(Ke&&t.texStorage2D(i.TEXTURE_2D,ce,we,se.width,se.height),N&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,se.width,se.height,xe,Ae,se.data)):t.texImage2D(i.TEXTURE_2D,0,we,se.width,se.height,0,xe,Ae,se.data);else if(x.isCompressedTexture)if(x.isCompressedArrayTexture){Ie&&Ke&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ce,we,Oe[0].width,Oe[0].height,se.depth);for(let H=0,Q=Oe.length;H<Q;H++)if(fe=Oe[H],x.format!==Wt)if(xe!==null)if(Ie){if(N)if(x.layerUpdates.size>0){const me=ll(fe.width,fe.height,x.format,x.type);for(const ge of x.layerUpdates){const Ge=fe.data.subarray(ge*me/fe.data.BYTES_PER_ELEMENT,(ge+1)*me/fe.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,H,0,0,ge,fe.width,fe.height,1,xe,Ge,0,0)}x.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,H,0,0,0,fe.width,fe.height,se.depth,xe,fe.data,0,0)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,H,we,fe.width,fe.height,se.depth,0,fe.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Ie?N&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,H,0,0,0,fe.width,fe.height,se.depth,xe,Ae,fe.data):t.texImage3D(i.TEXTURE_2D_ARRAY,H,we,fe.width,fe.height,se.depth,0,xe,Ae,fe.data)}else{Ie&&Ke&&t.texStorage2D(i.TEXTURE_2D,ce,we,Oe[0].width,Oe[0].height);for(let H=0,Q=Oe.length;H<Q;H++)fe=Oe[H],x.format!==Wt?xe!==null?Ie?N&&t.compressedTexSubImage2D(i.TEXTURE_2D,H,0,0,fe.width,fe.height,xe,fe.data):t.compressedTexImage2D(i.TEXTURE_2D,H,we,fe.width,fe.height,0,fe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Ie?N&&t.texSubImage2D(i.TEXTURE_2D,H,0,0,fe.width,fe.height,xe,Ae,fe.data):t.texImage2D(i.TEXTURE_2D,H,we,fe.width,fe.height,0,xe,Ae,fe.data)}else if(x.isDataArrayTexture)if(Ie){if(Ke&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ce,we,se.width,se.height,se.depth),N)if(x.layerUpdates.size>0){const H=ll(se.width,se.height,x.format,x.type);for(const Q of x.layerUpdates){const me=se.data.subarray(Q*H/se.data.BYTES_PER_ELEMENT,(Q+1)*H/se.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,Q,se.width,se.height,1,xe,Ae,me)}x.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,se.width,se.height,se.depth,xe,Ae,se.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,we,se.width,se.height,se.depth,0,xe,Ae,se.data);else if(x.isData3DTexture)Ie?(Ke&&t.texStorage3D(i.TEXTURE_3D,ce,we,se.width,se.height,se.depth),N&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,se.width,se.height,se.depth,xe,Ae,se.data)):t.texImage3D(i.TEXTURE_3D,0,we,se.width,se.height,se.depth,0,xe,Ae,se.data);else if(x.isFramebufferTexture){if(Ke)if(Ie)t.texStorage2D(i.TEXTURE_2D,ce,we,se.width,se.height);else{let H=se.width,Q=se.height;for(let me=0;me<ce;me++)t.texImage2D(i.TEXTURE_2D,me,we,H,Q,0,xe,Ae,null),H>>=1,Q>>=1}}else if(Oe.length>0){if(Ie&&Ke){const H=Pe(Oe[0]);t.texStorage2D(i.TEXTURE_2D,ce,we,H.width,H.height)}for(let H=0,Q=Oe.length;H<Q;H++)fe=Oe[H],Ie?N&&t.texSubImage2D(i.TEXTURE_2D,H,0,0,xe,Ae,fe):t.texImage2D(i.TEXTURE_2D,H,we,xe,Ae,fe);x.generateMipmaps=!1}else if(Ie){if(Ke){const H=Pe(se);t.texStorage2D(i.TEXTURE_2D,ce,we,H.width,H.height)}N&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,xe,Ae,se)}else t.texImage2D(i.TEXTURE_2D,0,we,xe,Ae,se);p(x)&&d(K),Ee.__version=j.version,x.onUpdate&&x.onUpdate(x)}A.__version=x.version}function Y(A,x,z){if(x.image.length!==6)return;const K=He(A,x),J=x.source;t.bindTexture(i.TEXTURE_CUBE_MAP,A.__webglTexture,i.TEXTURE0+z);const j=n.get(J);if(J.version!==j.__version||K===!0){t.activeTexture(i.TEXTURE0+z);const Ee=Je.getPrimaries(Je.workingColorSpace),ue=x.colorSpace===Sn?null:Je.getPrimaries(x.colorSpace),pe=x.colorSpace===Sn||Ee===ue?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,pe);const qe=x.isCompressedTexture||x.image[0].isCompressedTexture,se=x.image[0]&&x.image[0].isDataTexture,xe=[];for(let Q=0;Q<6;Q++)!qe&&!se?xe[Q]=M(x.image[Q],!0,s.maxCubemapSize):xe[Q]=se?x.image[Q].image:x.image[Q],xe[Q]=Qe(x,xe[Q]);const Ae=xe[0],we=r.convert(x.format,x.colorSpace),fe=r.convert(x.type),Oe=b(x.internalFormat,we,fe,x.colorSpace),Ie=x.isVideoTexture!==!0,Ke=j.__version===void 0||K===!0,N=J.dataReady;let ce=w(x,Ae);ye(i.TEXTURE_CUBE_MAP,x);let H;if(qe){Ie&&Ke&&t.texStorage2D(i.TEXTURE_CUBE_MAP,ce,Oe,Ae.width,Ae.height);for(let Q=0;Q<6;Q++){H=xe[Q].mipmaps;for(let me=0;me<H.length;me++){const ge=H[me];x.format!==Wt?we!==null?Ie?N&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me,0,0,ge.width,ge.height,we,ge.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me,Oe,ge.width,ge.height,0,ge.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me,0,0,ge.width,ge.height,we,fe,ge.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me,Oe,ge.width,ge.height,0,we,fe,ge.data)}}}else{if(H=x.mipmaps,Ie&&Ke){H.length>0&&ce++;const Q=Pe(xe[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,ce,Oe,Q.width,Q.height)}for(let Q=0;Q<6;Q++)if(se){Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,xe[Q].width,xe[Q].height,we,fe,xe[Q].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,Oe,xe[Q].width,xe[Q].height,0,we,fe,xe[Q].data);for(let me=0;me<H.length;me++){const Ge=H[me].image[Q].image;Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me+1,0,0,Ge.width,Ge.height,we,fe,Ge.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me+1,Oe,Ge.width,Ge.height,0,we,fe,Ge.data)}}else{Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,we,fe,xe[Q]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,Oe,we,fe,xe[Q]);for(let me=0;me<H.length;me++){const ge=H[me];Ie?N&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me+1,0,0,we,fe,ge.image[Q]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,me+1,Oe,we,fe,ge.image[Q])}}}p(x)&&d(i.TEXTURE_CUBE_MAP),j.__version=J.version,x.onUpdate&&x.onUpdate(x)}A.__version=x.version}function re(A,x,z,K,J,j){const Ee=r.convert(z.format,z.colorSpace),ue=r.convert(z.type),pe=b(z.internalFormat,Ee,ue,z.colorSpace);if(!n.get(x).__hasExternalTextures){const se=Math.max(1,x.width>>j),xe=Math.max(1,x.height>>j);J===i.TEXTURE_3D||J===i.TEXTURE_2D_ARRAY?t.texImage3D(J,j,pe,se,xe,x.depth,0,Ee,ue,null):t.texImage2D(J,j,pe,se,xe,0,Ee,ue,null)}t.bindFramebuffer(i.FRAMEBUFFER,A),Ye(x)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,K,J,n.get(z).__webglTexture,0,ke(x)):(J===i.TEXTURE_2D||J>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&J<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,K,J,n.get(z).__webglTexture,j),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Me(A,x,z){if(i.bindRenderbuffer(i.RENDERBUFFER,A),x.depthBuffer){const K=x.depthTexture,J=K&&K.isDepthTexture?K.type:null,j=y(x.stencilBuffer,J),Ee=x.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ue=ke(x);Ye(x)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ue,j,x.width,x.height):z?i.renderbufferStorageMultisample(i.RENDERBUFFER,ue,j,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,j,x.width,x.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,Ee,i.RENDERBUFFER,A)}else{const K=x.textures;for(let J=0;J<K.length;J++){const j=K[J],Ee=r.convert(j.format,j.colorSpace),ue=r.convert(j.type),pe=b(j.internalFormat,Ee,ue,j.colorSpace),qe=ke(x);z&&Ye(x)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,qe,pe,x.width,x.height):Ye(x)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,qe,pe,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,pe,x.width,x.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Se(A,x){if(x&&x.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,A),!(x.depthTexture&&x.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!n.get(x.depthTexture).__webglTexture||x.depthTexture.image.width!==x.width||x.depthTexture.image.height!==x.height)&&(x.depthTexture.image.width=x.width,x.depthTexture.image.height=x.height,x.depthTexture.needsUpdate=!0),Z(x.depthTexture,0);const K=n.get(x.depthTexture).__webglTexture,J=ke(x);if(x.depthTexture.format===gi)Ye(x)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,K,0,J):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,K,0);else if(x.depthTexture.format===Ti)Ye(x)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,K,0,J):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,K,0);else throw new Error("Unknown depthTexture format")}function De(A){const x=n.get(A),z=A.isWebGLCubeRenderTarget===!0;if(x.__boundDepthTexture!==A.depthTexture){const K=A.depthTexture;if(x.__depthDisposeCallback&&x.__depthDisposeCallback(),K){const J=()=>{delete x.__boundDepthTexture,delete x.__depthDisposeCallback,K.removeEventListener("dispose",J)};K.addEventListener("dispose",J),x.__depthDisposeCallback=J}x.__boundDepthTexture=K}if(A.depthTexture&&!x.__autoAllocateDepthBuffer){if(z)throw new Error("target.depthTexture not supported in Cube render targets");Se(x.__webglFramebuffer,A)}else if(z){x.__webglDepthbuffer=[];for(let K=0;K<6;K++)if(t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer[K]),x.__webglDepthbuffer[K]===void 0)x.__webglDepthbuffer[K]=i.createRenderbuffer(),Me(x.__webglDepthbuffer[K],A,!1);else{const J=A.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,j=x.__webglDepthbuffer[K];i.bindRenderbuffer(i.RENDERBUFFER,j),i.framebufferRenderbuffer(i.FRAMEBUFFER,J,i.RENDERBUFFER,j)}}else if(t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer),x.__webglDepthbuffer===void 0)x.__webglDepthbuffer=i.createRenderbuffer(),Me(x.__webglDepthbuffer,A,!1);else{const K=A.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,J=x.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,J),i.framebufferRenderbuffer(i.FRAMEBUFFER,K,i.RENDERBUFFER,J)}t.bindFramebuffer(i.FRAMEBUFFER,null)}function Re(A,x,z){const K=n.get(A);x!==void 0&&re(K.__webglFramebuffer,A,A.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),z!==void 0&&De(A)}function Xe(A){const x=A.texture,z=n.get(A),K=n.get(x);A.addEventListener("dispose",I);const J=A.textures,j=A.isWebGLCubeRenderTarget===!0,Ee=J.length>1;if(Ee||(K.__webglTexture===void 0&&(K.__webglTexture=i.createTexture()),K.__version=x.version,o.memory.textures++),j){z.__webglFramebuffer=[];for(let ue=0;ue<6;ue++)if(x.mipmaps&&x.mipmaps.length>0){z.__webglFramebuffer[ue]=[];for(let pe=0;pe<x.mipmaps.length;pe++)z.__webglFramebuffer[ue][pe]=i.createFramebuffer()}else z.__webglFramebuffer[ue]=i.createFramebuffer()}else{if(x.mipmaps&&x.mipmaps.length>0){z.__webglFramebuffer=[];for(let ue=0;ue<x.mipmaps.length;ue++)z.__webglFramebuffer[ue]=i.createFramebuffer()}else z.__webglFramebuffer=i.createFramebuffer();if(Ee)for(let ue=0,pe=J.length;ue<pe;ue++){const qe=n.get(J[ue]);qe.__webglTexture===void 0&&(qe.__webglTexture=i.createTexture(),o.memory.textures++)}if(A.samples>0&&Ye(A)===!1){z.__webglMultisampledFramebuffer=i.createFramebuffer(),z.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,z.__webglMultisampledFramebuffer);for(let ue=0;ue<J.length;ue++){const pe=J[ue];z.__webglColorRenderbuffer[ue]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,z.__webglColorRenderbuffer[ue]);const qe=r.convert(pe.format,pe.colorSpace),se=r.convert(pe.type),xe=b(pe.internalFormat,qe,se,pe.colorSpace,A.isXRRenderTarget===!0),Ae=ke(A);i.renderbufferStorageMultisample(i.RENDERBUFFER,Ae,xe,A.width,A.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ue,i.RENDERBUFFER,z.__webglColorRenderbuffer[ue])}i.bindRenderbuffer(i.RENDERBUFFER,null),A.depthBuffer&&(z.__webglDepthRenderbuffer=i.createRenderbuffer(),Me(z.__webglDepthRenderbuffer,A,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(j){t.bindTexture(i.TEXTURE_CUBE_MAP,K.__webglTexture),ye(i.TEXTURE_CUBE_MAP,x);for(let ue=0;ue<6;ue++)if(x.mipmaps&&x.mipmaps.length>0)for(let pe=0;pe<x.mipmaps.length;pe++)re(z.__webglFramebuffer[ue][pe],A,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+ue,pe);else re(z.__webglFramebuffer[ue],A,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+ue,0);p(x)&&d(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Ee){for(let ue=0,pe=J.length;ue<pe;ue++){const qe=J[ue],se=n.get(qe);t.bindTexture(i.TEXTURE_2D,se.__webglTexture),ye(i.TEXTURE_2D,qe),re(z.__webglFramebuffer,A,qe,i.COLOR_ATTACHMENT0+ue,i.TEXTURE_2D,0),p(qe)&&d(i.TEXTURE_2D)}t.unbindTexture()}else{let ue=i.TEXTURE_2D;if((A.isWebGL3DRenderTarget||A.isWebGLArrayRenderTarget)&&(ue=A.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(ue,K.__webglTexture),ye(ue,x),x.mipmaps&&x.mipmaps.length>0)for(let pe=0;pe<x.mipmaps.length;pe++)re(z.__webglFramebuffer[pe],A,x,i.COLOR_ATTACHMENT0,ue,pe);else re(z.__webglFramebuffer,A,x,i.COLOR_ATTACHMENT0,ue,0);p(x)&&d(ue),t.unbindTexture()}A.depthBuffer&&De(A)}function $e(A){const x=A.textures;for(let z=0,K=x.length;z<K;z++){const J=x[z];if(p(J)){const j=A.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:i.TEXTURE_2D,Ee=n.get(J).__webglTexture;t.bindTexture(j,Ee),d(j),t.unbindTexture()}}}const ze=[],D=[];function _t(A){if(A.samples>0){if(Ye(A)===!1){const x=A.textures,z=A.width,K=A.height;let J=i.COLOR_BUFFER_BIT;const j=A.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,Ee=n.get(A),ue=x.length>1;if(ue)for(let pe=0;pe<x.length;pe++)t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,Ee.__webglFramebuffer);for(let pe=0;pe<x.length;pe++){if(A.resolveDepthBuffer&&(A.depthBuffer&&(J|=i.DEPTH_BUFFER_BIT),A.stencilBuffer&&A.resolveStencilBuffer&&(J|=i.STENCIL_BUFFER_BIT)),ue){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,Ee.__webglColorRenderbuffer[pe]);const qe=n.get(x[pe]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,qe,0)}i.blitFramebuffer(0,0,z,K,0,0,z,K,J,i.NEAREST),l===!0&&(ze.length=0,D.length=0,ze.push(i.COLOR_ATTACHMENT0+pe),A.depthBuffer&&A.resolveDepthBuffer===!1&&(ze.push(j),D.push(j),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,D)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,ze))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),ue)for(let pe=0;pe<x.length;pe++){t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.RENDERBUFFER,Ee.__webglColorRenderbuffer[pe]);const qe=n.get(x[pe]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.TEXTURE_2D,qe,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer)}else if(A.depthBuffer&&A.resolveDepthBuffer===!1&&l){const x=A.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[x])}}}function ke(A){return Math.min(s.maxSamples,A.samples)}function Ye(A){const x=n.get(A);return A.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&x.__useRenderToTexture!==!1}function Ce(A){const x=o.render.frame;u.get(A)!==x&&(u.set(A,x),A.update())}function Qe(A,x){const z=A.colorSpace,K=A.format,J=A.type;return A.isCompressedTexture===!0||A.isVideoTexture===!0||z!==Rn&&z!==Sn&&(Je.getTransfer(z)===nt?(K!==Wt||J!==cn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",z)),x}function Pe(A){return typeof HTMLImageElement<"u"&&A instanceof HTMLImageElement?(c.width=A.naturalWidth||A.width,c.height=A.naturalHeight||A.height):typeof VideoFrame<"u"&&A instanceof VideoFrame?(c.width=A.displayWidth,c.height=A.displayHeight):(c.width=A.width,c.height=A.height),c}this.allocateTextureUnit=W,this.resetTextureUnits=E,this.setTexture2D=Z,this.setTexture2DArray=ie,this.setTexture3D=X,this.setTextureCube=ne,this.rebindTextures=Re,this.setupRenderTarget=Xe,this.updateRenderTargetMipmap=$e,this.updateMultisampleRenderTarget=_t,this.setupDepthRenderbuffer=De,this.setupFrameBufferTexture=re,this.useMultisampledRTT=Ye}function Rm(i,e){function t(n,s=Sn){let r;const o=Je.getTransfer(s);if(n===cn)return i.UNSIGNED_BYTE;if(n===qo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===jo)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Vl)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===Hl)return i.BYTE;if(n===Gl)return i.SHORT;if(n===Vi)return i.UNSIGNED_SHORT;if(n===Yo)return i.INT;if(n===Hn)return i.UNSIGNED_INT;if(n===on)return i.FLOAT;if(n===Wi)return i.HALF_FLOAT;if(n===Wl)return i.ALPHA;if(n===Xl)return i.RGB;if(n===Wt)return i.RGBA;if(n===Yl)return i.LUMINANCE;if(n===ql)return i.LUMINANCE_ALPHA;if(n===gi)return i.DEPTH_COMPONENT;if(n===Ti)return i.DEPTH_STENCIL;if(n===jl)return i.RED;if(n===Ko)return i.RED_INTEGER;if(n===Kl)return i.RG;if(n===$o)return i.RG_INTEGER;if(n===Zo)return i.RGBA_INTEGER;if(n===Ps||n===Ls||n===Ds||n===Is)if(o===nt)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Ps)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Ls)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Ds)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Is)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Ps)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Ls)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Ds)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Is)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===fo||n===po||n===mo||n===_o)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===fo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===po)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===mo)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===_o)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===go||n===vo||n===xo)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===go||n===vo)return o===nt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===xo)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===Mo||n===So||n===yo||n===Eo||n===bo||n===To||n===Ao||n===wo||n===Ro||n===Co||n===Po||n===Lo||n===Do||n===Io)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===Mo)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===So)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===yo)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Eo)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===bo)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===To)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Ao)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===wo)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===Ro)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Co)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Po)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Lo)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Do)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Io)return o===nt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Ns||n===No||n===Uo)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===Ns)return o===nt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===No)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Uo)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===$l||n===Fo||n===Oo||n===Bo)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===Ns)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Fo)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Oo)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Bo)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===bi?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}class Cm extends Nt{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class yn extends ft{constructor(){super(),this.isGroup=!0,this.type="Group"}}const Pm={type:"move"};class Gr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new yn,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new yn,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new O,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new O),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new yn,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new O,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new O),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null;const a=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(const M of e.hand.values()){const p=t.getJointPose(M,n),d=this._getHandJoint(c,M);p!==null&&(d.matrix.fromArray(p.transform.matrix),d.matrix.decompose(d.position,d.rotation,d.scale),d.matrixWorldNeedsUpdate=!0,d.jointRadius=p.radius),d.visible=p!==null}const u=c.joints["index-finger-tip"],_=c.joints["thumb-tip"],m=u.position.distanceTo(_.position),h=.02,g=.005;c.inputState.pinching&&m>h+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&m<=h-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(Pm)))}return a!==null&&(a.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new yn;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}const Lm=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Dm=`
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

}`;class Im{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){const s=new bt,r=e.properties.get(s);r.__webglTexture=t.texture,(t.depthNear!=n.depthNear||t.depthFar!=n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=s}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,n=new wn({vertexShader:Lm,fragmentShader:Dm,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Ft(new nr(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class Nm extends Xn{constructor(e,t){super();const n=this;let s=null,r=1,o=null,a="local-floor",l=1,c=null,u=null,_=null,m=null,h=null,g=null;const M=new Im,p=t.getContextAttributes();let d=null,b=null;const y=[],w=[],B=new Le;let I=null;const P=new Nt;P.layers.enable(1),P.viewport=new rt;const F=new Nt;F.layers.enable(2),F.viewport=new rt;const te=[P,F],v=new Cm;v.layers.enable(1),v.layers.enable(2);let E=null,W=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(Y){let re=y[Y];return re===void 0&&(re=new Gr,y[Y]=re),re.getTargetRaySpace()},this.getControllerGrip=function(Y){let re=y[Y];return re===void 0&&(re=new Gr,y[Y]=re),re.getGripSpace()},this.getHand=function(Y){let re=y[Y];return re===void 0&&(re=new Gr,y[Y]=re),re.getHandSpace()};function V(Y){const re=w.indexOf(Y.inputSource);if(re===-1)return;const Me=y[re];Me!==void 0&&(Me.update(Y.inputSource,Y.frame,c||o),Me.dispatchEvent({type:Y.type,data:Y.inputSource}))}function Z(){s.removeEventListener("select",V),s.removeEventListener("selectstart",V),s.removeEventListener("selectend",V),s.removeEventListener("squeeze",V),s.removeEventListener("squeezestart",V),s.removeEventListener("squeezeend",V),s.removeEventListener("end",Z),s.removeEventListener("inputsourceschange",ie);for(let Y=0;Y<y.length;Y++){const re=w[Y];re!==null&&(w[Y]=null,y[Y].disconnect(re))}E=null,W=null,M.reset(),e.setRenderTarget(d),h=null,m=null,_=null,s=null,b=null,Be.stop(),n.isPresenting=!1,e.setPixelRatio(I),e.setSize(B.width,B.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(Y){r=Y,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(Y){a=Y,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(Y){c=Y},this.getBaseLayer=function(){return m!==null?m:h},this.getBinding=function(){return _},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function(Y){if(s=Y,s!==null){if(d=e.getRenderTarget(),s.addEventListener("select",V),s.addEventListener("selectstart",V),s.addEventListener("selectend",V),s.addEventListener("squeeze",V),s.addEventListener("squeezestart",V),s.addEventListener("squeezeend",V),s.addEventListener("end",Z),s.addEventListener("inputsourceschange",ie),p.xrCompatible!==!0&&await t.makeXRCompatible(),I=e.getPixelRatio(),e.getSize(B),s.renderState.layers===void 0){const re={antialias:p.antialias,alpha:!0,depth:p.depth,stencil:p.stencil,framebufferScaleFactor:r};h=new XRWebGLLayer(s,t,re),s.updateRenderState({baseLayer:h}),e.setPixelRatio(1),e.setSize(h.framebufferWidth,h.framebufferHeight,!1),b=new Gn(h.framebufferWidth,h.framebufferHeight,{format:Wt,type:cn,colorSpace:e.outputColorSpace,stencilBuffer:p.stencil})}else{let re=null,Me=null,Se=null;p.depth&&(Se=p.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,re=p.stencil?Ti:gi,Me=p.stencil?bi:Hn);const De={colorFormat:t.RGBA8,depthFormat:Se,scaleFactor:r};_=new XRWebGLBinding(s,t),m=_.createProjectionLayer(De),s.updateRenderState({layers:[m]}),e.setPixelRatio(1),e.setSize(m.textureWidth,m.textureHeight,!1),b=new Gn(m.textureWidth,m.textureHeight,{format:Wt,type:cn,depthTexture:new uc(m.textureWidth,m.textureHeight,Me,void 0,void 0,void 0,void 0,void 0,void 0,re),stencilBuffer:p.stencil,colorSpace:e.outputColorSpace,samples:p.antialias?4:0,resolveDepthBuffer:m.ignoreDepthValues===!1})}b.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await s.requestReferenceSpace(a),Be.setContext(s),Be.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return M.getDepthTexture()};function ie(Y){for(let re=0;re<Y.removed.length;re++){const Me=Y.removed[re],Se=w.indexOf(Me);Se>=0&&(w[Se]=null,y[Se].disconnect(Me))}for(let re=0;re<Y.added.length;re++){const Me=Y.added[re];let Se=w.indexOf(Me);if(Se===-1){for(let Re=0;Re<y.length;Re++)if(Re>=w.length){w.push(Me),Se=Re;break}else if(w[Re]===null){w[Re]=Me,Se=Re;break}if(Se===-1)break}const De=y[Se];De&&De.connect(Me)}}const X=new O,ne=new O;function G(Y,re,Me){X.setFromMatrixPosition(re.matrixWorld),ne.setFromMatrixPosition(Me.matrixWorld);const Se=X.distanceTo(ne),De=re.projectionMatrix.elements,Re=Me.projectionMatrix.elements,Xe=De[14]/(De[10]-1),$e=De[14]/(De[10]+1),ze=(De[9]+1)/De[5],D=(De[9]-1)/De[5],_t=(De[8]-1)/De[0],ke=(Re[8]+1)/Re[0],Ye=Xe*_t,Ce=Xe*ke,Qe=Se/(-_t+ke),Pe=Qe*-_t;if(re.matrixWorld.decompose(Y.position,Y.quaternion,Y.scale),Y.translateX(Pe),Y.translateZ(Qe),Y.matrixWorld.compose(Y.position,Y.quaternion,Y.scale),Y.matrixWorldInverse.copy(Y.matrixWorld).invert(),De[10]===-1)Y.projectionMatrix.copy(re.projectionMatrix),Y.projectionMatrixInverse.copy(re.projectionMatrixInverse);else{const A=Xe+Qe,x=$e+Qe,z=Ye-Pe,K=Ce+(Se-Pe),J=ze*$e/x*A,j=D*$e/x*A;Y.projectionMatrix.makePerspective(z,K,J,j,A,x),Y.projectionMatrixInverse.copy(Y.projectionMatrix).invert()}}function _e(Y,re){re===null?Y.matrixWorld.copy(Y.matrix):Y.matrixWorld.multiplyMatrices(re.matrixWorld,Y.matrix),Y.matrixWorldInverse.copy(Y.matrixWorld).invert()}this.updateCamera=function(Y){if(s===null)return;let re=Y.near,Me=Y.far;M.texture!==null&&(M.depthNear>0&&(re=M.depthNear),M.depthFar>0&&(Me=M.depthFar)),v.near=F.near=P.near=re,v.far=F.far=P.far=Me,(E!==v.near||W!==v.far)&&(s.updateRenderState({depthNear:v.near,depthFar:v.far}),E=v.near,W=v.far);const Se=Y.parent,De=v.cameras;_e(v,Se);for(let Re=0;Re<De.length;Re++)_e(De[Re],Se);De.length===2?G(v,P,F):v.projectionMatrix.copy(P.projectionMatrix),ve(Y,v,Se)};function ve(Y,re,Me){Me===null?Y.matrix.copy(re.matrixWorld):(Y.matrix.copy(Me.matrixWorld),Y.matrix.invert(),Y.matrix.multiply(re.matrixWorld)),Y.matrix.decompose(Y.position,Y.quaternion,Y.scale),Y.updateMatrixWorld(!0),Y.projectionMatrix.copy(re.projectionMatrix),Y.projectionMatrixInverse.copy(re.projectionMatrixInverse),Y.isPerspectiveCamera&&(Y.fov=zo*2*Math.atan(1/Y.projectionMatrix.elements[5]),Y.zoom=1)}this.getCamera=function(){return v},this.getFoveation=function(){if(!(m===null&&h===null))return l},this.setFoveation=function(Y){l=Y,m!==null&&(m.fixedFoveation=Y),h!==null&&h.fixedFoveation!==void 0&&(h.fixedFoveation=Y)},this.hasDepthSensing=function(){return M.texture!==null},this.getDepthSensingMesh=function(){return M.getMesh(v)};let ye=null;function He(Y,re){if(u=re.getViewerPose(c||o),g=re,u!==null){const Me=u.views;h!==null&&(e.setRenderTargetFramebuffer(b,h.framebuffer),e.setRenderTarget(b));let Se=!1;Me.length!==v.cameras.length&&(v.cameras.length=0,Se=!0);for(let Re=0;Re<Me.length;Re++){const Xe=Me[Re];let $e=null;if(h!==null)$e=h.getViewport(Xe);else{const D=_.getViewSubImage(m,Xe);$e=D.viewport,Re===0&&(e.setRenderTargetTextures(b,D.colorTexture,m.ignoreDepthValues?void 0:D.depthStencilTexture),e.setRenderTarget(b))}let ze=te[Re];ze===void 0&&(ze=new Nt,ze.layers.enable(Re),ze.viewport=new rt,te[Re]=ze),ze.matrix.fromArray(Xe.transform.matrix),ze.matrix.decompose(ze.position,ze.quaternion,ze.scale),ze.projectionMatrix.fromArray(Xe.projectionMatrix),ze.projectionMatrixInverse.copy(ze.projectionMatrix).invert(),ze.viewport.set($e.x,$e.y,$e.width,$e.height),Re===0&&(v.matrix.copy(ze.matrix),v.matrix.decompose(v.position,v.quaternion,v.scale)),Se===!0&&v.cameras.push(ze)}const De=s.enabledFeatures;if(De&&De.includes("depth-sensing")){const Re=_.getDepthInformation(Me[0]);Re&&Re.isValid&&Re.texture&&M.init(e,Re,s.renderState)}}for(let Me=0;Me<y.length;Me++){const Se=w[Me],De=y[Me];Se!==null&&De!==void 0&&De.update(Se,re,c||o)}ye&&ye(Y,re),re.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:re}),g=null}const Be=new lc;Be.setAnimationLoop(He),this.setAnimationLoop=function(Y){ye=Y},this.dispose=function(){}}}const Nn=new Zt,Um=new tt;function Fm(i,e){function t(p,d){p.matrixAutoUpdate===!0&&p.updateMatrix(),d.value.copy(p.matrix)}function n(p,d){d.color.getRGB(p.fogColor.value,rc(i)),d.isFog?(p.fogNear.value=d.near,p.fogFar.value=d.far):d.isFogExp2&&(p.fogDensity.value=d.density)}function s(p,d,b,y,w){d.isMeshBasicMaterial||d.isMeshLambertMaterial?r(p,d):d.isMeshToonMaterial?(r(p,d),_(p,d)):d.isMeshPhongMaterial?(r(p,d),u(p,d)):d.isMeshStandardMaterial?(r(p,d),m(p,d),d.isMeshPhysicalMaterial&&h(p,d,w)):d.isMeshMatcapMaterial?(r(p,d),g(p,d)):d.isMeshDepthMaterial?r(p,d):d.isMeshDistanceMaterial?(r(p,d),M(p,d)):d.isMeshNormalMaterial?r(p,d):d.isLineBasicMaterial?(o(p,d),d.isLineDashedMaterial&&a(p,d)):d.isPointsMaterial?l(p,d,b,y):d.isSpriteMaterial?c(p,d):d.isShadowMaterial?(p.color.value.copy(d.color),p.opacity.value=d.opacity):d.isShaderMaterial&&(d.uniformsNeedUpdate=!1)}function r(p,d){p.opacity.value=d.opacity,d.color&&p.diffuse.value.copy(d.color),d.emissive&&p.emissive.value.copy(d.emissive).multiplyScalar(d.emissiveIntensity),d.map&&(p.map.value=d.map,t(d.map,p.mapTransform)),d.alphaMap&&(p.alphaMap.value=d.alphaMap,t(d.alphaMap,p.alphaMapTransform)),d.bumpMap&&(p.bumpMap.value=d.bumpMap,t(d.bumpMap,p.bumpMapTransform),p.bumpScale.value=d.bumpScale,d.side===Et&&(p.bumpScale.value*=-1)),d.normalMap&&(p.normalMap.value=d.normalMap,t(d.normalMap,p.normalMapTransform),p.normalScale.value.copy(d.normalScale),d.side===Et&&p.normalScale.value.negate()),d.displacementMap&&(p.displacementMap.value=d.displacementMap,t(d.displacementMap,p.displacementMapTransform),p.displacementScale.value=d.displacementScale,p.displacementBias.value=d.displacementBias),d.emissiveMap&&(p.emissiveMap.value=d.emissiveMap,t(d.emissiveMap,p.emissiveMapTransform)),d.specularMap&&(p.specularMap.value=d.specularMap,t(d.specularMap,p.specularMapTransform)),d.alphaTest>0&&(p.alphaTest.value=d.alphaTest);const b=e.get(d),y=b.envMap,w=b.envMapRotation;y&&(p.envMap.value=y,Nn.copy(w),Nn.x*=-1,Nn.y*=-1,Nn.z*=-1,y.isCubeTexture&&y.isRenderTargetTexture===!1&&(Nn.y*=-1,Nn.z*=-1),p.envMapRotation.value.setFromMatrix4(Um.makeRotationFromEuler(Nn)),p.flipEnvMap.value=y.isCubeTexture&&y.isRenderTargetTexture===!1?-1:1,p.reflectivity.value=d.reflectivity,p.ior.value=d.ior,p.refractionRatio.value=d.refractionRatio),d.lightMap&&(p.lightMap.value=d.lightMap,p.lightMapIntensity.value=d.lightMapIntensity,t(d.lightMap,p.lightMapTransform)),d.aoMap&&(p.aoMap.value=d.aoMap,p.aoMapIntensity.value=d.aoMapIntensity,t(d.aoMap,p.aoMapTransform))}function o(p,d){p.diffuse.value.copy(d.color),p.opacity.value=d.opacity,d.map&&(p.map.value=d.map,t(d.map,p.mapTransform))}function a(p,d){p.dashSize.value=d.dashSize,p.totalSize.value=d.dashSize+d.gapSize,p.scale.value=d.scale}function l(p,d,b,y){p.diffuse.value.copy(d.color),p.opacity.value=d.opacity,p.size.value=d.size*b,p.scale.value=y*.5,d.map&&(p.map.value=d.map,t(d.map,p.uvTransform)),d.alphaMap&&(p.alphaMap.value=d.alphaMap,t(d.alphaMap,p.alphaMapTransform)),d.alphaTest>0&&(p.alphaTest.value=d.alphaTest)}function c(p,d){p.diffuse.value.copy(d.color),p.opacity.value=d.opacity,p.rotation.value=d.rotation,d.map&&(p.map.value=d.map,t(d.map,p.mapTransform)),d.alphaMap&&(p.alphaMap.value=d.alphaMap,t(d.alphaMap,p.alphaMapTransform)),d.alphaTest>0&&(p.alphaTest.value=d.alphaTest)}function u(p,d){p.specular.value.copy(d.specular),p.shininess.value=Math.max(d.shininess,1e-4)}function _(p,d){d.gradientMap&&(p.gradientMap.value=d.gradientMap)}function m(p,d){p.metalness.value=d.metalness,d.metalnessMap&&(p.metalnessMap.value=d.metalnessMap,t(d.metalnessMap,p.metalnessMapTransform)),p.roughness.value=d.roughness,d.roughnessMap&&(p.roughnessMap.value=d.roughnessMap,t(d.roughnessMap,p.roughnessMapTransform)),d.envMap&&(p.envMapIntensity.value=d.envMapIntensity)}function h(p,d,b){p.ior.value=d.ior,d.sheen>0&&(p.sheenColor.value.copy(d.sheenColor).multiplyScalar(d.sheen),p.sheenRoughness.value=d.sheenRoughness,d.sheenColorMap&&(p.sheenColorMap.value=d.sheenColorMap,t(d.sheenColorMap,p.sheenColorMapTransform)),d.sheenRoughnessMap&&(p.sheenRoughnessMap.value=d.sheenRoughnessMap,t(d.sheenRoughnessMap,p.sheenRoughnessMapTransform))),d.clearcoat>0&&(p.clearcoat.value=d.clearcoat,p.clearcoatRoughness.value=d.clearcoatRoughness,d.clearcoatMap&&(p.clearcoatMap.value=d.clearcoatMap,t(d.clearcoatMap,p.clearcoatMapTransform)),d.clearcoatRoughnessMap&&(p.clearcoatRoughnessMap.value=d.clearcoatRoughnessMap,t(d.clearcoatRoughnessMap,p.clearcoatRoughnessMapTransform)),d.clearcoatNormalMap&&(p.clearcoatNormalMap.value=d.clearcoatNormalMap,t(d.clearcoatNormalMap,p.clearcoatNormalMapTransform),p.clearcoatNormalScale.value.copy(d.clearcoatNormalScale),d.side===Et&&p.clearcoatNormalScale.value.negate())),d.dispersion>0&&(p.dispersion.value=d.dispersion),d.iridescence>0&&(p.iridescence.value=d.iridescence,p.iridescenceIOR.value=d.iridescenceIOR,p.iridescenceThicknessMinimum.value=d.iridescenceThicknessRange[0],p.iridescenceThicknessMaximum.value=d.iridescenceThicknessRange[1],d.iridescenceMap&&(p.iridescenceMap.value=d.iridescenceMap,t(d.iridescenceMap,p.iridescenceMapTransform)),d.iridescenceThicknessMap&&(p.iridescenceThicknessMap.value=d.iridescenceThicknessMap,t(d.iridescenceThicknessMap,p.iridescenceThicknessMapTransform))),d.transmission>0&&(p.transmission.value=d.transmission,p.transmissionSamplerMap.value=b.texture,p.transmissionSamplerSize.value.set(b.width,b.height),d.transmissionMap&&(p.transmissionMap.value=d.transmissionMap,t(d.transmissionMap,p.transmissionMapTransform)),p.thickness.value=d.thickness,d.thicknessMap&&(p.thicknessMap.value=d.thicknessMap,t(d.thicknessMap,p.thicknessMapTransform)),p.attenuationDistance.value=d.attenuationDistance,p.attenuationColor.value.copy(d.attenuationColor)),d.anisotropy>0&&(p.anisotropyVector.value.set(d.anisotropy*Math.cos(d.anisotropyRotation),d.anisotropy*Math.sin(d.anisotropyRotation)),d.anisotropyMap&&(p.anisotropyMap.value=d.anisotropyMap,t(d.anisotropyMap,p.anisotropyMapTransform))),p.specularIntensity.value=d.specularIntensity,p.specularColor.value.copy(d.specularColor),d.specularColorMap&&(p.specularColorMap.value=d.specularColorMap,t(d.specularColorMap,p.specularColorMapTransform)),d.specularIntensityMap&&(p.specularIntensityMap.value=d.specularIntensityMap,t(d.specularIntensityMap,p.specularIntensityMapTransform))}function g(p,d){d.matcap&&(p.matcap.value=d.matcap)}function M(p,d){const b=e.get(d).light;p.referencePosition.value.setFromMatrixPosition(b.matrixWorld),p.nearDistance.value=b.shadow.camera.near,p.farDistance.value=b.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Om(i,e,t,n){let s={},r={},o=[];const a=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(b,y){const w=y.program;n.uniformBlockBinding(b,w)}function c(b,y){let w=s[b.id];w===void 0&&(g(b),w=u(b),s[b.id]=w,b.addEventListener("dispose",p));const B=y.program;n.updateUBOMapping(b,B);const I=e.render.frame;r[b.id]!==I&&(m(b),r[b.id]=I)}function u(b){const y=_();b.__bindingPointIndex=y;const w=i.createBuffer(),B=b.__size,I=b.usage;return i.bindBuffer(i.UNIFORM_BUFFER,w),i.bufferData(i.UNIFORM_BUFFER,B,I),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,y,w),w}function _(){for(let b=0;b<a;b++)if(o.indexOf(b)===-1)return o.push(b),b;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function m(b){const y=s[b.id],w=b.uniforms,B=b.__cache;i.bindBuffer(i.UNIFORM_BUFFER,y);for(let I=0,P=w.length;I<P;I++){const F=Array.isArray(w[I])?w[I]:[w[I]];for(let te=0,v=F.length;te<v;te++){const E=F[te];if(h(E,I,te,B)===!0){const W=E.__offset,V=Array.isArray(E.value)?E.value:[E.value];let Z=0;for(let ie=0;ie<V.length;ie++){const X=V[ie],ne=M(X);typeof X=="number"||typeof X=="boolean"?(E.__data[0]=X,i.bufferSubData(i.UNIFORM_BUFFER,W+Z,E.__data)):X.isMatrix3?(E.__data[0]=X.elements[0],E.__data[1]=X.elements[1],E.__data[2]=X.elements[2],E.__data[3]=0,E.__data[4]=X.elements[3],E.__data[5]=X.elements[4],E.__data[6]=X.elements[5],E.__data[7]=0,E.__data[8]=X.elements[6],E.__data[9]=X.elements[7],E.__data[10]=X.elements[8],E.__data[11]=0):(X.toArray(E.__data,Z),Z+=ne.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,W,E.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function h(b,y,w,B){const I=b.value,P=y+"_"+w;if(B[P]===void 0)return typeof I=="number"||typeof I=="boolean"?B[P]=I:B[P]=I.clone(),!0;{const F=B[P];if(typeof I=="number"||typeof I=="boolean"){if(F!==I)return B[P]=I,!0}else if(F.equals(I)===!1)return F.copy(I),!0}return!1}function g(b){const y=b.uniforms;let w=0;const B=16;for(let P=0,F=y.length;P<F;P++){const te=Array.isArray(y[P])?y[P]:[y[P]];for(let v=0,E=te.length;v<E;v++){const W=te[v],V=Array.isArray(W.value)?W.value:[W.value];for(let Z=0,ie=V.length;Z<ie;Z++){const X=V[Z],ne=M(X),G=w%B,_e=G%ne.boundary,ve=G+_e;w+=_e,ve!==0&&B-ve<ne.storage&&(w+=B-ve),W.__data=new Float32Array(ne.storage/Float32Array.BYTES_PER_ELEMENT),W.__offset=w,w+=ne.storage}}}const I=w%B;return I>0&&(w+=B-I),b.__size=w,b.__cache={},this}function M(b){const y={boundary:0,storage:0};return typeof b=="number"||typeof b=="boolean"?(y.boundary=4,y.storage=4):b.isVector2?(y.boundary=8,y.storage=8):b.isVector3||b.isColor?(y.boundary=16,y.storage=12):b.isVector4?(y.boundary=16,y.storage=16):b.isMatrix3?(y.boundary=48,y.storage=48):b.isMatrix4?(y.boundary=64,y.storage=64):b.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",b),y}function p(b){const y=b.target;y.removeEventListener("dispose",p);const w=o.indexOf(y.__bindingPointIndex);o.splice(w,1),i.deleteBuffer(s[y.id]),delete s[y.id],delete r[y.id]}function d(){for(const b in s)i.deleteBuffer(s[b]);o=[],s={},r={}}return{bind:l,update:c,dispose:d}}class Bm{constructor(e={}){const{canvas:t=bu(),context:n=null,depth:s=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:_=!1}=e;this.isWebGLRenderer=!0;let m;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");m=n.getContextAttributes().alpha}else m=o;const h=new Uint32Array(4),g=new Int32Array(4);let M=null,p=null;const d=[],b=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=qt,this.toneMapping=Tn,this.toneMappingExposure=1;const y=this;let w=!1,B=0,I=0,P=null,F=-1,te=null;const v=new rt,E=new rt;let W=null;const V=new We(0);let Z=0,ie=t.width,X=t.height,ne=1,G=null,_e=null;const ve=new rt(0,0,ie,X),ye=new rt(0,0,ie,X);let He=!1;const Be=new ta;let Y=!1,re=!1;const Me=new tt,Se=new tt,De=new O,Re=new rt,Xe={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let $e=!1;function ze(){return P===null?ne:1}let D=n;function _t(f,S){return t.getContext(f,S)}try{const f={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:u,failIfMajorPerformanceCaveat:_};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Xo}`),t.addEventListener("webglcontextlost",Q,!1),t.addEventListener("webglcontextrestored",me,!1),t.addEventListener("webglcontextcreationerror",ge,!1),D===null){const S="webgl2";if(D=_t(S,f),D===null)throw _t(S)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(f){throw console.error("THREE.WebGLRenderer: "+f.message),f}let ke,Ye,Ce,Qe,Pe,A,x,z,K,J,j,Ee,ue,pe,qe,se,xe,Ae,we,fe,Oe,Ie,Ke,N;function ce(){ke=new Vf(D),ke.init(),Ie=new Rm(D,ke),Ye=new Of(D,ke,e,Ie),Ce=new Tm(D),Ye.reverseDepthBuffer&&Ce.buffers.depth.setReversed(!0),Qe=new Yf(D),Pe=new um,A=new wm(D,ke,Ce,Pe,Ye,Ie,Qe),x=new zf(y),z=new Gf(y),K=new Ju(D),Ke=new Uf(D,K),J=new Wf(D,K,Qe,Ke),j=new jf(D,J,K,Qe),we=new qf(D,Ye,A),se=new Bf(Pe),Ee=new cm(y,x,z,ke,Ye,Ke,se),ue=new Fm(y,Pe),pe=new dm,qe=new vm(ke),Ae=new Nf(y,x,z,Ce,j,m,l),xe=new Em(y,j,Ye),N=new Om(D,Qe,Ye,Ce),fe=new Ff(D,ke,Qe),Oe=new Xf(D,ke,Qe),Qe.programs=Ee.programs,y.capabilities=Ye,y.extensions=ke,y.properties=Pe,y.renderLists=pe,y.shadowMap=xe,y.state=Ce,y.info=Qe}ce();const H=new Nm(y,D);this.xr=H,this.getContext=function(){return D},this.getContextAttributes=function(){return D.getContextAttributes()},this.forceContextLoss=function(){const f=ke.get("WEBGL_lose_context");f&&f.loseContext()},this.forceContextRestore=function(){const f=ke.get("WEBGL_lose_context");f&&f.restoreContext()},this.getPixelRatio=function(){return ne},this.setPixelRatio=function(f){f!==void 0&&(ne=f,this.setSize(ie,X,!1))},this.getSize=function(f){return f.set(ie,X)},this.setSize=function(f,S,L=!0){if(H.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}ie=f,X=S,t.width=Math.floor(f*ne),t.height=Math.floor(S*ne),L===!0&&(t.style.width=f+"px",t.style.height=S+"px"),this.setViewport(0,0,f,S)},this.getDrawingBufferSize=function(f){return f.set(ie*ne,X*ne).floor()},this.setDrawingBufferSize=function(f,S,L){ie=f,X=S,ne=L,t.width=Math.floor(f*L),t.height=Math.floor(S*L),this.setViewport(0,0,f,S)},this.getCurrentViewport=function(f){return f.copy(v)},this.getViewport=function(f){return f.copy(ve)},this.setViewport=function(f,S,L,T){f.isVector4?ve.set(f.x,f.y,f.z,f.w):ve.set(f,S,L,T),Ce.viewport(v.copy(ve).multiplyScalar(ne).round())},this.getScissor=function(f){return f.copy(ye)},this.setScissor=function(f,S,L,T){f.isVector4?ye.set(f.x,f.y,f.z,f.w):ye.set(f,S,L,T),Ce.scissor(E.copy(ye).multiplyScalar(ne).round())},this.getScissorTest=function(){return He},this.setScissorTest=function(f){Ce.setScissorTest(He=f)},this.setOpaqueSort=function(f){G=f},this.setTransparentSort=function(f){_e=f},this.getClearColor=function(f){return f.copy(Ae.getClearColor())},this.setClearColor=function(){Ae.setClearColor.apply(Ae,arguments)},this.getClearAlpha=function(){return Ae.getClearAlpha()},this.setClearAlpha=function(){Ae.setClearAlpha.apply(Ae,arguments)},this.clear=function(f=!0,S=!0,L=!0){let T=0;if(f){let C=!1;if(P!==null){const k=P.texture.format;C=k===Zo||k===$o||k===Ko}if(C){const k=P.texture.type,q=k===cn||k===Hn||k===Vi||k===bi||k===qo||k===jo,$=Ae.getClearColor(),ee=Ae.getClearAlpha(),le=$.r,he=$.g,oe=$.b;q?(h[0]=le,h[1]=he,h[2]=oe,h[3]=ee,D.clearBufferuiv(D.COLOR,0,h)):(g[0]=le,g[1]=he,g[2]=oe,g[3]=ee,D.clearBufferiv(D.COLOR,0,g))}else T|=D.COLOR_BUFFER_BIT}S&&(T|=D.DEPTH_BUFFER_BIT,D.clearDepth(this.capabilities.reverseDepthBuffer?0:1)),L&&(T|=D.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),D.clear(T)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",Q,!1),t.removeEventListener("webglcontextrestored",me,!1),t.removeEventListener("webglcontextcreationerror",ge,!1),pe.dispose(),qe.dispose(),Pe.dispose(),x.dispose(),z.dispose(),j.dispose(),Ke.dispose(),N.dispose(),Ee.dispose(),H.dispose(),H.removeEventListener("sessionstart",$i),H.removeEventListener("sessionend",Zi),Yt.stop()};function Q(f){f.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),w=!0}function me(){console.log("THREE.WebGLRenderer: Context Restored."),w=!1;const f=Qe.autoReset,S=xe.enabled,L=xe.autoUpdate,T=xe.needsUpdate,C=xe.type;ce(),Qe.autoReset=f,xe.enabled=S,xe.autoUpdate=L,xe.needsUpdate=T,xe.type=C}function ge(f){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",f.statusMessage)}function Ge(f){const S=f.target;S.removeEventListener("dispose",Ge),it(S)}function it(f){pt(f),Pe.remove(f)}function pt(f){const S=Pe.get(f).programs;S!==void 0&&(S.forEach(function(L){Ee.releaseProgram(L)}),f.isShaderMaterial&&Ee.releaseShaderCache(f))}this.renderBufferDirect=function(f,S,L,T,C,k){S===null&&(S=Xe);const q=C.isMesh&&C.matrixWorld.determinant()<0,$=cr(f,S,L,T,C);Ce.setMaterial(T,q);let ee=L.index,le=1;if(T.wireframe===!0){if(ee=J.getWireframeAttribute(L),ee===void 0)return;le=2}const he=L.drawRange,oe=L.attributes.position;let ae=he.start*le,Te=(he.start+he.count)*le;k!==null&&(ae=Math.max(ae,k.start*le),Te=Math.min(Te,(k.start+k.count)*le)),ee!==null?(ae=Math.max(ae,0),Te=Math.min(Te,ee.count)):oe!=null&&(ae=Math.max(ae,0),Te=Math.min(Te,oe.count));const Ne=Te-ae;if(Ne<0||Ne===1/0)return;Ke.setup(C,T,$,L,ee);let st,je=fe;if(ee!==null&&(st=K.get(ee),je=Oe,je.setIndex(st)),C.isMesh)T.wireframe===!0?(Ce.setLineWidth(T.wireframeLinewidth*ze()),je.setMode(D.LINES)):je.setMode(D.TRIANGLES);else if(C.isLine){let be=T.linewidth;be===void 0&&(be=1),Ce.setLineWidth(be*ze()),C.isLineSegments?je.setMode(D.LINES):C.isLineLoop?je.setMode(D.LINE_LOOP):je.setMode(D.LINE_STRIP)}else C.isPoints?je.setMode(D.POINTS):C.isSprite&&je.setMode(D.TRIANGLES);if(C.isBatchedMesh)if(C._multiDrawInstances!==null)je.renderMultiDrawInstances(C._multiDrawStarts,C._multiDrawCounts,C._multiDrawCount,C._multiDrawInstances);else if(ke.get("WEBGL_multi_draw"))je.renderMultiDraw(C._multiDrawStarts,C._multiDrawCounts,C._multiDrawCount);else{const be=C._multiDrawStarts,at=C._multiDrawCounts,Ze=C._multiDrawCount,Bt=ee?K.get(ee).bytesPerElement:1,$n=Pe.get(T).currentProgram.getUniforms();for(let At=0;At<Ze;At++)$n.setValue(D,"_gl_DrawID",At),je.render(be[At]/Bt,at[At])}else if(C.isInstancedMesh)je.renderInstances(ae,Ne,C.count);else if(L.isInstancedBufferGeometry){const be=L._maxInstanceCount!==void 0?L._maxInstanceCount:1/0,at=Math.min(L.instanceCount,be);je.renderInstances(ae,Ne,at)}else je.render(ae,Ne)};function Ve(f,S,L){f.transparent===!0&&f.side===rn&&f.forceSinglePass===!1?(f.side=Et,f.needsUpdate=!0,Kn(f,S,L),f.side=An,f.needsUpdate=!0,Kn(f,S,L),f.side=rn):Kn(f,S,L)}this.compile=function(f,S,L=null){L===null&&(L=f),p=qe.get(L),p.init(S),b.push(p),L.traverseVisible(function(C){C.isLight&&C.layers.test(S.layers)&&(p.pushLight(C),C.castShadow&&p.pushShadow(C))}),f!==L&&f.traverseVisible(function(C){C.isLight&&C.layers.test(S.layers)&&(p.pushLight(C),C.castShadow&&p.pushShadow(C))}),p.setupLights();const T=new Set;return f.traverse(function(C){if(!(C.isMesh||C.isPoints||C.isLine||C.isSprite))return;const k=C.material;if(k)if(Array.isArray(k))for(let q=0;q<k.length;q++){const $=k[q];Ve($,L,C),T.add($)}else Ve(k,L,C),T.add(k)}),b.pop(),p=null,T},this.compileAsync=function(f,S,L=null){const T=this.compile(f,S,L);return new Promise(C=>{function k(){if(T.forEach(function(q){Pe.get(q).currentProgram.isReady()&&T.delete(q)}),T.size===0){C(f);return}setTimeout(k,10)}ke.get("KHR_parallel_shader_compile")!==null?k():setTimeout(k,10)})};let mt=null;function Lt(f){mt&&mt(f)}function $i(){Yt.stop()}function Zi(){Yt.start()}const Yt=new lc;Yt.setAnimationLoop(Lt),typeof self<"u"&&Yt.setContext(self),this.setAnimationLoop=function(f){mt=f,H.setAnimationLoop(f),f===null?Yt.stop():Yt.start()},H.addEventListener("sessionstart",$i),H.addEventListener("sessionend",Zi),this.render=function(f,S){if(S!==void 0&&S.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(w===!0)return;if(f.matrixWorldAutoUpdate===!0&&f.updateMatrixWorld(),S.parent===null&&S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),H.enabled===!0&&H.isPresenting===!0&&(H.cameraAutoUpdate===!0&&H.updateCamera(S),S=H.getCamera()),f.isScene===!0&&f.onBeforeRender(y,f,S,P),p=qe.get(f,b.length),p.init(S),b.push(p),Se.multiplyMatrices(S.projectionMatrix,S.matrixWorldInverse),Be.setFromProjectionMatrix(Se),re=this.localClippingEnabled,Y=se.init(this.clippingPlanes,re),M=pe.get(f,d.length),M.init(),d.push(M),H.enabled===!0&&H.isPresenting===!0){const k=y.xr.getDepthSensingMesh();k!==null&&hn(k,S,-1/0,y.sortObjects)}hn(f,S,0,y.sortObjects),M.finish(),y.sortObjects===!0&&M.sort(G,_e),$e=H.enabled===!1||H.isPresenting===!1||H.hasDepthSensing()===!1,$e&&Ae.addToRenderList(M,f),this.info.render.frame++,Y===!0&&se.beginShadows();const L=p.state.shadowsArray;xe.render(L,f,S),Y===!0&&se.endShadows(),this.info.autoReset===!0&&this.info.reset();const T=M.opaque,C=M.transmissive;if(p.setupLights(),S.isArrayCamera){const k=S.cameras;if(C.length>0)for(let q=0,$=k.length;q<$;q++){const ee=k[q];Qi(T,C,f,ee)}$e&&Ae.render(f);for(let q=0,$=k.length;q<$;q++){const ee=k[q];Ji(M,f,ee,ee.viewport)}}else C.length>0&&Qi(T,C,f,S),$e&&Ae.render(f),Ji(M,f,S);P!==null&&(A.updateMultisampleRenderTarget(P),A.updateRenderTargetMipmap(P)),f.isScene===!0&&f.onAfterRender(y,f,S),Ke.resetDefaultState(),F=-1,te=null,b.pop(),b.length>0?(p=b[b.length-1],Y===!0&&se.setGlobalState(y.clippingPlanes,p.state.camera)):p=null,d.pop(),d.length>0?M=d[d.length-1]:M=null};function hn(f,S,L,T){if(f.visible===!1)return;if(f.layers.test(S.layers)){if(f.isGroup)L=f.renderOrder;else if(f.isLOD)f.autoUpdate===!0&&f.update(S);else if(f.isLight)p.pushLight(f),f.castShadow&&p.pushShadow(f);else if(f.isSprite){if(!f.frustumCulled||Be.intersectsSprite(f)){T&&Re.setFromMatrixPosition(f.matrixWorld).applyMatrix4(Se);const q=j.update(f),$=f.material;$.visible&&M.push(f,q,$,L,Re.z,null)}}else if((f.isMesh||f.isLine||f.isPoints)&&(!f.frustumCulled||Be.intersectsObject(f))){const q=j.update(f),$=f.material;if(T&&(f.boundingSphere!==void 0?(f.boundingSphere===null&&f.computeBoundingSphere(),Re.copy(f.boundingSphere.center)):(q.boundingSphere===null&&q.computeBoundingSphere(),Re.copy(q.boundingSphere.center)),Re.applyMatrix4(f.matrixWorld).applyMatrix4(Se)),Array.isArray($)){const ee=q.groups;for(let le=0,he=ee.length;le<he;le++){const oe=ee[le],ae=$[oe.materialIndex];ae&&ae.visible&&M.push(f,q,ae,L,Re.z,oe)}}else $.visible&&M.push(f,q,$,L,Re.z,null)}}const k=f.children;for(let q=0,$=k.length;q<$;q++)hn(k[q],S,L,T)}function Ji(f,S,L,T){const C=f.opaque,k=f.transmissive,q=f.transparent;p.setupLightsView(L),Y===!0&&se.setGlobalState(y.clippingPlanes,L),T&&Ce.viewport(v.copy(T)),C.length>0&&jn(C,S,L),k.length>0&&jn(k,S,L),q.length>0&&jn(q,S,L),Ce.buffers.depth.setTest(!0),Ce.buffers.depth.setMask(!0),Ce.buffers.color.setMask(!0),Ce.setPolygonOffset(!1)}function Qi(f,S,L,T){if((L.isScene===!0?L.overrideMaterial:null)!==null)return;p.state.transmissionRenderTarget[T.id]===void 0&&(p.state.transmissionRenderTarget[T.id]=new Gn(1,1,{generateMipmaps:!0,type:ke.has("EXT_color_buffer_half_float")||ke.has("EXT_color_buffer_float")?Wi:cn,minFilter:kn,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Je.workingColorSpace}));const k=p.state.transmissionRenderTarget[T.id],q=T.viewport||v;k.setSize(q.z,q.w);const $=y.getRenderTarget();y.setRenderTarget(k),y.getClearColor(V),Z=y.getClearAlpha(),Z<1&&y.setClearColor(16777215,.5),y.clear(),$e&&Ae.render(L);const ee=y.toneMapping;y.toneMapping=Tn;const le=T.viewport;if(T.viewport!==void 0&&(T.viewport=void 0),p.setupLightsView(T),Y===!0&&se.setGlobalState(y.clippingPlanes,T),jn(f,L,T),A.updateMultisampleRenderTarget(k),A.updateRenderTargetMipmap(k),ke.has("WEBGL_multisampled_render_to_texture")===!1){let he=!1;for(let oe=0,ae=S.length;oe<ae;oe++){const Te=S[oe],Ne=Te.object,st=Te.geometry,je=Te.material,be=Te.group;if(je.side===rn&&Ne.layers.test(T.layers)){const at=je.side;je.side=Et,je.needsUpdate=!0,es(Ne,L,T,st,je,be),je.side=at,je.needsUpdate=!0,he=!0}}he===!0&&(A.updateMultisampleRenderTarget(k),A.updateRenderTargetMipmap(k))}y.setRenderTarget($),y.setClearColor(V,Z),le!==void 0&&(T.viewport=le),y.toneMapping=ee}function jn(f,S,L){const T=S.isScene===!0?S.overrideMaterial:null;for(let C=0,k=f.length;C<k;C++){const q=f[C],$=q.object,ee=q.geometry,le=T===null?q.material:T,he=q.group;$.layers.test(L.layers)&&es($,S,L,ee,le,he)}}function es(f,S,L,T,C,k){f.onBeforeRender(y,S,L,T,C,k),f.modelViewMatrix.multiplyMatrices(L.matrixWorldInverse,f.matrixWorld),f.normalMatrix.getNormalMatrix(f.modelViewMatrix),C.onBeforeRender(y,S,L,T,f,k),C.transparent===!0&&C.side===rn&&C.forceSinglePass===!1?(C.side=Et,C.needsUpdate=!0,y.renderBufferDirect(L,S,T,C,f,k),C.side=An,C.needsUpdate=!0,y.renderBufferDirect(L,S,T,C,f,k),C.side=rn):y.renderBufferDirect(L,S,T,C,f,k),f.onAfterRender(y,S,L,T,C,k)}function Kn(f,S,L){S.isScene!==!0&&(S=Xe);const T=Pe.get(f),C=p.state.lights,k=p.state.shadowsArray,q=C.state.version,$=Ee.getParameters(f,C.state,k,S,L),ee=Ee.getProgramCacheKey($);let le=T.programs;T.environment=f.isMeshStandardMaterial?S.environment:null,T.fog=S.fog,T.envMap=(f.isMeshStandardMaterial?z:x).get(f.envMap||T.environment),T.envMapRotation=T.environment!==null&&f.envMap===null?S.environmentRotation:f.envMapRotation,le===void 0&&(f.addEventListener("dispose",Ge),le=new Map,T.programs=le);let he=le.get(ee);if(he!==void 0){if(T.currentProgram===he&&T.lightsStateVersion===q)return ns(f,$),he}else $.uniforms=Ee.getUniforms(f),f.onBeforeCompile($,y),he=Ee.acquireProgram($,ee),le.set(ee,he),T.uniforms=$.uniforms;const oe=T.uniforms;return(!f.isShaderMaterial&&!f.isRawShaderMaterial||f.clipping===!0)&&(oe.clippingPlanes=se.uniform),ns(f,$),T.needsLights=U(f),T.lightsStateVersion=q,T.needsLights&&(oe.ambientLightColor.value=C.state.ambient,oe.lightProbe.value=C.state.probe,oe.directionalLights.value=C.state.directional,oe.directionalLightShadows.value=C.state.directionalShadow,oe.spotLights.value=C.state.spot,oe.spotLightShadows.value=C.state.spotShadow,oe.rectAreaLights.value=C.state.rectArea,oe.ltc_1.value=C.state.rectAreaLTC1,oe.ltc_2.value=C.state.rectAreaLTC2,oe.pointLights.value=C.state.point,oe.pointLightShadows.value=C.state.pointShadow,oe.hemisphereLights.value=C.state.hemi,oe.directionalShadowMap.value=C.state.directionalShadowMap,oe.directionalShadowMatrix.value=C.state.directionalShadowMatrix,oe.spotShadowMap.value=C.state.spotShadowMap,oe.spotLightMatrix.value=C.state.spotLightMatrix,oe.spotLightMap.value=C.state.spotLightMap,oe.pointShadowMap.value=C.state.pointShadowMap,oe.pointShadowMatrix.value=C.state.pointShadowMatrix),T.currentProgram=he,T.uniformsList=null,he}function ts(f){if(f.uniformsList===null){const S=f.currentProgram.getUniforms();f.uniformsList=Os.seqWithValue(S.seq,f.uniforms)}return f.uniformsList}function ns(f,S){const L=Pe.get(f);L.outputColorSpace=S.outputColorSpace,L.batching=S.batching,L.batchingColor=S.batchingColor,L.instancing=S.instancing,L.instancingColor=S.instancingColor,L.instancingMorph=S.instancingMorph,L.skinning=S.skinning,L.morphTargets=S.morphTargets,L.morphNormals=S.morphNormals,L.morphColors=S.morphColors,L.morphTargetsCount=S.morphTargetsCount,L.numClippingPlanes=S.numClippingPlanes,L.numIntersection=S.numClipIntersection,L.vertexAlphas=S.vertexAlphas,L.vertexTangents=S.vertexTangents,L.toneMapping=S.toneMapping}function cr(f,S,L,T,C){S.isScene!==!0&&(S=Xe),A.resetTextureUnits();const k=S.fog,q=T.isMeshStandardMaterial?S.environment:null,$=P===null?y.outputColorSpace:P.isXRRenderTarget===!0?P.texture.colorSpace:Rn,ee=(T.isMeshStandardMaterial?z:x).get(T.envMap||q),le=T.vertexColors===!0&&!!L.attributes.color&&L.attributes.color.itemSize===4,he=!!L.attributes.tangent&&(!!T.normalMap||T.anisotropy>0),oe=!!L.morphAttributes.position,ae=!!L.morphAttributes.normal,Te=!!L.morphAttributes.color;let Ne=Tn;T.toneMapped&&(P===null||P.isXRRenderTarget===!0)&&(Ne=y.toneMapping);const st=L.morphAttributes.position||L.morphAttributes.normal||L.morphAttributes.color,je=st!==void 0?st.length:0,be=Pe.get(T),at=p.state.lights;if(Y===!0&&(re===!0||f!==te)){const Dt=f===te&&T.id===F;se.setState(T,f,Dt)}let Ze=!1;T.version===be.__version?(be.needsLights&&be.lightsStateVersion!==at.state.version||be.outputColorSpace!==$||C.isBatchedMesh&&be.batching===!1||!C.isBatchedMesh&&be.batching===!0||C.isBatchedMesh&&be.batchingColor===!0&&C.colorTexture===null||C.isBatchedMesh&&be.batchingColor===!1&&C.colorTexture!==null||C.isInstancedMesh&&be.instancing===!1||!C.isInstancedMesh&&be.instancing===!0||C.isSkinnedMesh&&be.skinning===!1||!C.isSkinnedMesh&&be.skinning===!0||C.isInstancedMesh&&be.instancingColor===!0&&C.instanceColor===null||C.isInstancedMesh&&be.instancingColor===!1&&C.instanceColor!==null||C.isInstancedMesh&&be.instancingMorph===!0&&C.morphTexture===null||C.isInstancedMesh&&be.instancingMorph===!1&&C.morphTexture!==null||be.envMap!==ee||T.fog===!0&&be.fog!==k||be.numClippingPlanes!==void 0&&(be.numClippingPlanes!==se.numPlanes||be.numIntersection!==se.numIntersection)||be.vertexAlphas!==le||be.vertexTangents!==he||be.morphTargets!==oe||be.morphNormals!==ae||be.morphColors!==Te||be.toneMapping!==Ne||be.morphTargetsCount!==je)&&(Ze=!0):(Ze=!0,be.__version=T.version);let Bt=be.currentProgram;Ze===!0&&(Bt=Kn(T,S,C));let $n=!1,At=!1,ur=!1;const ot=Bt.getUniforms(),dn=be.uniforms;if(Ce.useProgram(Bt.program)&&($n=!0,At=!0,ur=!0),T.id!==F&&(F=T.id,At=!0),$n||te!==f){Ye.reverseDepthBuffer?(Me.copy(f.projectionMatrix),Au(Me),wu(Me),ot.setValue(D,"projectionMatrix",Me)):ot.setValue(D,"projectionMatrix",f.projectionMatrix),ot.setValue(D,"viewMatrix",f.matrixWorldInverse);const Dt=ot.map.cameraPosition;Dt!==void 0&&Dt.setValue(D,De.setFromMatrixPosition(f.matrixWorld)),Ye.logarithmicDepthBuffer&&ot.setValue(D,"logDepthBufFC",2/(Math.log(f.far+1)/Math.LN2)),(T.isMeshPhongMaterial||T.isMeshToonMaterial||T.isMeshLambertMaterial||T.isMeshBasicMaterial||T.isMeshStandardMaterial||T.isShaderMaterial)&&ot.setValue(D,"isOrthographic",f.isOrthographicCamera===!0),te!==f&&(te=f,At=!0,ur=!0)}if(C.isSkinnedMesh){ot.setOptional(D,C,"bindMatrix"),ot.setOptional(D,C,"bindMatrixInverse");const Dt=C.skeleton;Dt&&(Dt.boneTexture===null&&Dt.computeBoneTexture(),ot.setValue(D,"boneTexture",Dt.boneTexture,A))}C.isBatchedMesh&&(ot.setOptional(D,C,"batchingTexture"),ot.setValue(D,"batchingTexture",C._matricesTexture,A),ot.setOptional(D,C,"batchingIdTexture"),ot.setValue(D,"batchingIdTexture",C._indirectTexture,A),ot.setOptional(D,C,"batchingColorTexture"),C._colorsTexture!==null&&ot.setValue(D,"batchingColorTexture",C._colorsTexture,A));const hr=L.morphAttributes;if((hr.position!==void 0||hr.normal!==void 0||hr.color!==void 0)&&we.update(C,L,Bt),(At||be.receiveShadow!==C.receiveShadow)&&(be.receiveShadow=C.receiveShadow,ot.setValue(D,"receiveShadow",C.receiveShadow)),T.isMeshGouraudMaterial&&T.envMap!==null&&(dn.envMap.value=ee,dn.flipEnvMap.value=ee.isCubeTexture&&ee.isRenderTargetTexture===!1?-1:1),T.isMeshStandardMaterial&&T.envMap===null&&S.environment!==null&&(dn.envMapIntensity.value=S.environmentIntensity),At&&(ot.setValue(D,"toneMappingExposure",y.toneMappingExposure),be.needsLights&&R(dn,ur),k&&T.fog===!0&&ue.refreshFogUniforms(dn,k),ue.refreshMaterialUniforms(dn,T,ne,X,p.state.transmissionRenderTarget[f.id]),Os.upload(D,ts(be),dn,A)),T.isShaderMaterial&&T.uniformsNeedUpdate===!0&&(Os.upload(D,ts(be),dn,A),T.uniformsNeedUpdate=!1),T.isSpriteMaterial&&ot.setValue(D,"center",C.center),ot.setValue(D,"modelViewMatrix",C.modelViewMatrix),ot.setValue(D,"normalMatrix",C.normalMatrix),ot.setValue(D,"modelMatrix",C.matrixWorld),T.isShaderMaterial||T.isRawShaderMaterial){const Dt=T.uniformsGroups;for(let dr=0,Dc=Dt.length;dr<Dc;dr++){const pa=Dt[dr];N.update(pa,Bt),N.bind(pa,Bt)}}return Bt}function R(f,S){f.ambientLightColor.needsUpdate=S,f.lightProbe.needsUpdate=S,f.directionalLights.needsUpdate=S,f.directionalLightShadows.needsUpdate=S,f.pointLights.needsUpdate=S,f.pointLightShadows.needsUpdate=S,f.spotLights.needsUpdate=S,f.spotLightShadows.needsUpdate=S,f.rectAreaLights.needsUpdate=S,f.hemisphereLights.needsUpdate=S}function U(f){return f.isMeshLambertMaterial||f.isMeshToonMaterial||f.isMeshPhongMaterial||f.isMeshStandardMaterial||f.isShadowMaterial||f.isShaderMaterial&&f.lights===!0}this.getActiveCubeFace=function(){return B},this.getActiveMipmapLevel=function(){return I},this.getRenderTarget=function(){return P},this.setRenderTargetTextures=function(f,S,L){Pe.get(f.texture).__webglTexture=S,Pe.get(f.depthTexture).__webglTexture=L;const T=Pe.get(f);T.__hasExternalTextures=!0,T.__autoAllocateDepthBuffer=L===void 0,T.__autoAllocateDepthBuffer||ke.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),T.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(f,S){const L=Pe.get(f);L.__webglFramebuffer=S,L.__useDefaultFramebuffer=S===void 0},this.setRenderTarget=function(f,S=0,L=0){P=f,B=S,I=L;let T=!0,C=null,k=!1,q=!1;if(f){const ee=Pe.get(f);if(ee.__useDefaultFramebuffer!==void 0)Ce.bindFramebuffer(D.FRAMEBUFFER,null),T=!1;else if(ee.__webglFramebuffer===void 0)A.setupRenderTarget(f);else if(ee.__hasExternalTextures)A.rebindTextures(f,Pe.get(f.texture).__webglTexture,Pe.get(f.depthTexture).__webglTexture);else if(f.depthBuffer){const oe=f.depthTexture;if(ee.__boundDepthTexture!==oe){if(oe!==null&&Pe.has(oe)&&(f.width!==oe.image.width||f.height!==oe.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");A.setupDepthRenderbuffer(f)}}const le=f.texture;(le.isData3DTexture||le.isDataArrayTexture||le.isCompressedArrayTexture)&&(q=!0);const he=Pe.get(f).__webglFramebuffer;f.isWebGLCubeRenderTarget?(Array.isArray(he[S])?C=he[S][L]:C=he[S],k=!0):f.samples>0&&A.useMultisampledRTT(f)===!1?C=Pe.get(f).__webglMultisampledFramebuffer:Array.isArray(he)?C=he[L]:C=he,v.copy(f.viewport),E.copy(f.scissor),W=f.scissorTest}else v.copy(ve).multiplyScalar(ne).floor(),E.copy(ye).multiplyScalar(ne).floor(),W=He;if(Ce.bindFramebuffer(D.FRAMEBUFFER,C)&&T&&Ce.drawBuffers(f,C),Ce.viewport(v),Ce.scissor(E),Ce.setScissorTest(W),k){const ee=Pe.get(f.texture);D.framebufferTexture2D(D.FRAMEBUFFER,D.COLOR_ATTACHMENT0,D.TEXTURE_CUBE_MAP_POSITIVE_X+S,ee.__webglTexture,L)}else if(q){const ee=Pe.get(f.texture),le=S||0;D.framebufferTextureLayer(D.FRAMEBUFFER,D.COLOR_ATTACHMENT0,ee.__webglTexture,L||0,le)}F=-1},this.readRenderTargetPixels=function(f,S,L,T,C,k,q){if(!(f&&f.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let $=Pe.get(f).__webglFramebuffer;if(f.isWebGLCubeRenderTarget&&q!==void 0&&($=$[q]),$){Ce.bindFramebuffer(D.FRAMEBUFFER,$);try{const ee=f.texture,le=ee.format,he=ee.type;if(!Ye.textureFormatReadable(le)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Ye.textureTypeReadable(he)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}S>=0&&S<=f.width-T&&L>=0&&L<=f.height-C&&D.readPixels(S,L,T,C,Ie.convert(le),Ie.convert(he),k)}finally{const ee=P!==null?Pe.get(P).__webglFramebuffer:null;Ce.bindFramebuffer(D.FRAMEBUFFER,ee)}}},this.readRenderTargetPixelsAsync=async function(f,S,L,T,C,k,q){if(!(f&&f.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let $=Pe.get(f).__webglFramebuffer;if(f.isWebGLCubeRenderTarget&&q!==void 0&&($=$[q]),$){const ee=f.texture,le=ee.format,he=ee.type;if(!Ye.textureFormatReadable(le))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Ye.textureTypeReadable(he))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(S>=0&&S<=f.width-T&&L>=0&&L<=f.height-C){Ce.bindFramebuffer(D.FRAMEBUFFER,$);const oe=D.createBuffer();D.bindBuffer(D.PIXEL_PACK_BUFFER,oe),D.bufferData(D.PIXEL_PACK_BUFFER,k.byteLength,D.STREAM_READ),D.readPixels(S,L,T,C,Ie.convert(le),Ie.convert(he),0);const ae=P!==null?Pe.get(P).__webglFramebuffer:null;Ce.bindFramebuffer(D.FRAMEBUFFER,ae);const Te=D.fenceSync(D.SYNC_GPU_COMMANDS_COMPLETE,0);return D.flush(),await Tu(D,Te,4),D.bindBuffer(D.PIXEL_PACK_BUFFER,oe),D.getBufferSubData(D.PIXEL_PACK_BUFFER,0,k),D.deleteBuffer(oe),D.deleteSync(Te),k}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(f,S=null,L=0){f.isTexture!==!0&&(Fs("WebGLRenderer: copyFramebufferToTexture function signature has changed."),S=arguments[0]||null,f=arguments[1]);const T=Math.pow(2,-L),C=Math.floor(f.image.width*T),k=Math.floor(f.image.height*T),q=S!==null?S.x:0,$=S!==null?S.y:0;A.setTexture2D(f,0),D.copyTexSubImage2D(D.TEXTURE_2D,L,0,0,q,$,C,k),Ce.unbindTexture()},this.copyTextureToTexture=function(f,S,L=null,T=null,C=0){f.isTexture!==!0&&(Fs("WebGLRenderer: copyTextureToTexture function signature has changed."),T=arguments[0]||null,f=arguments[1],S=arguments[2],C=arguments[3]||0,L=null);let k,q,$,ee,le,he;L!==null?(k=L.max.x-L.min.x,q=L.max.y-L.min.y,$=L.min.x,ee=L.min.y):(k=f.image.width,q=f.image.height,$=0,ee=0),T!==null?(le=T.x,he=T.y):(le=0,he=0);const oe=Ie.convert(S.format),ae=Ie.convert(S.type);A.setTexture2D(S,0),D.pixelStorei(D.UNPACK_FLIP_Y_WEBGL,S.flipY),D.pixelStorei(D.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),D.pixelStorei(D.UNPACK_ALIGNMENT,S.unpackAlignment);const Te=D.getParameter(D.UNPACK_ROW_LENGTH),Ne=D.getParameter(D.UNPACK_IMAGE_HEIGHT),st=D.getParameter(D.UNPACK_SKIP_PIXELS),je=D.getParameter(D.UNPACK_SKIP_ROWS),be=D.getParameter(D.UNPACK_SKIP_IMAGES),at=f.isCompressedTexture?f.mipmaps[C]:f.image;D.pixelStorei(D.UNPACK_ROW_LENGTH,at.width),D.pixelStorei(D.UNPACK_IMAGE_HEIGHT,at.height),D.pixelStorei(D.UNPACK_SKIP_PIXELS,$),D.pixelStorei(D.UNPACK_SKIP_ROWS,ee),f.isDataTexture?D.texSubImage2D(D.TEXTURE_2D,C,le,he,k,q,oe,ae,at.data):f.isCompressedTexture?D.compressedTexSubImage2D(D.TEXTURE_2D,C,le,he,at.width,at.height,oe,at.data):D.texSubImage2D(D.TEXTURE_2D,C,le,he,k,q,oe,ae,at),D.pixelStorei(D.UNPACK_ROW_LENGTH,Te),D.pixelStorei(D.UNPACK_IMAGE_HEIGHT,Ne),D.pixelStorei(D.UNPACK_SKIP_PIXELS,st),D.pixelStorei(D.UNPACK_SKIP_ROWS,je),D.pixelStorei(D.UNPACK_SKIP_IMAGES,be),C===0&&S.generateMipmaps&&D.generateMipmap(D.TEXTURE_2D),Ce.unbindTexture()},this.copyTextureToTexture3D=function(f,S,L=null,T=null,C=0){f.isTexture!==!0&&(Fs("WebGLRenderer: copyTextureToTexture3D function signature has changed."),L=arguments[0]||null,T=arguments[1]||null,f=arguments[2],S=arguments[3],C=arguments[4]||0);let k,q,$,ee,le,he,oe,ae,Te;const Ne=f.isCompressedTexture?f.mipmaps[C]:f.image;L!==null?(k=L.max.x-L.min.x,q=L.max.y-L.min.y,$=L.max.z-L.min.z,ee=L.min.x,le=L.min.y,he=L.min.z):(k=Ne.width,q=Ne.height,$=Ne.depth,ee=0,le=0,he=0),T!==null?(oe=T.x,ae=T.y,Te=T.z):(oe=0,ae=0,Te=0);const st=Ie.convert(S.format),je=Ie.convert(S.type);let be;if(S.isData3DTexture)A.setTexture3D(S,0),be=D.TEXTURE_3D;else if(S.isDataArrayTexture||S.isCompressedArrayTexture)A.setTexture2DArray(S,0),be=D.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}D.pixelStorei(D.UNPACK_FLIP_Y_WEBGL,S.flipY),D.pixelStorei(D.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),D.pixelStorei(D.UNPACK_ALIGNMENT,S.unpackAlignment);const at=D.getParameter(D.UNPACK_ROW_LENGTH),Ze=D.getParameter(D.UNPACK_IMAGE_HEIGHT),Bt=D.getParameter(D.UNPACK_SKIP_PIXELS),$n=D.getParameter(D.UNPACK_SKIP_ROWS),At=D.getParameter(D.UNPACK_SKIP_IMAGES);D.pixelStorei(D.UNPACK_ROW_LENGTH,Ne.width),D.pixelStorei(D.UNPACK_IMAGE_HEIGHT,Ne.height),D.pixelStorei(D.UNPACK_SKIP_PIXELS,ee),D.pixelStorei(D.UNPACK_SKIP_ROWS,le),D.pixelStorei(D.UNPACK_SKIP_IMAGES,he),f.isDataTexture||f.isData3DTexture?D.texSubImage3D(be,C,oe,ae,Te,k,q,$,st,je,Ne.data):S.isCompressedArrayTexture?D.compressedTexSubImage3D(be,C,oe,ae,Te,k,q,$,st,Ne.data):D.texSubImage3D(be,C,oe,ae,Te,k,q,$,st,je,Ne),D.pixelStorei(D.UNPACK_ROW_LENGTH,at),D.pixelStorei(D.UNPACK_IMAGE_HEIGHT,Ze),D.pixelStorei(D.UNPACK_SKIP_PIXELS,Bt),D.pixelStorei(D.UNPACK_SKIP_ROWS,$n),D.pixelStorei(D.UNPACK_SKIP_IMAGES,At),C===0&&S.generateMipmaps&&D.generateMipmap(be),Ce.unbindTexture()},this.initRenderTarget=function(f){Pe.get(f).__webglFramebuffer===void 0&&A.setupRenderTarget(f)},this.initTexture=function(f){f.isCubeTexture?A.setTextureCube(f,0):f.isData3DTexture?A.setTexture3D(f,0):f.isDataArrayTexture||f.isCompressedArrayTexture?A.setTexture2DArray(f,0):A.setTexture2D(f,0),Ce.unbindTexture()},this.resetState=function(){B=0,I=0,P=null,Ce.reset(),Ke.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return an}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorSpace=e===Jo?"display-p3":"srgb",t.unpackColorSpace=Je.workingColorSpace===Qs?"display-p3":"srgb"}}class ia{constructor(e,t=25e-5){this.isFogExp2=!0,this.name="",this.color=new We(e),this.density=t}clone(){return new ia(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class zm extends ft{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Zt,this.environmentIntensity=1,this.environmentRotation=new Zt,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}class qn extends Yn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new We(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}}const Xs=new O,Ys=new O,cl=new tt,Fi=new tr,bs=new er,Vr=new O,ul=new O;class sr extends ft{constructor(e=new Pt,t=new qn){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)Xs.fromBufferAttribute(t,s-1),Ys.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=Xs.distanceTo(Ys);e.setAttribute("lineDistance",new Tt(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){const n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),bs.copy(n.boundingSphere),bs.applyMatrix4(s),bs.radius+=r,e.ray.intersectsSphere(bs)===!1)return;cl.copy(s).invert(),Fi.copy(e.ray).applyMatrix4(cl);const a=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=this.isLineSegments?2:1,u=n.index,m=n.attributes.position;if(u!==null){const h=Math.max(0,o.start),g=Math.min(u.count,o.start+o.count);for(let M=h,p=g-1;M<p;M+=c){const d=u.getX(M),b=u.getX(M+1),y=Ts(this,e,Fi,l,d,b);y&&t.push(y)}if(this.isLineLoop){const M=u.getX(g-1),p=u.getX(h),d=Ts(this,e,Fi,l,M,p);d&&t.push(d)}}else{const h=Math.max(0,o.start),g=Math.min(m.count,o.start+o.count);for(let M=h,p=g-1;M<p;M+=c){const d=Ts(this,e,Fi,l,M,M+1);d&&t.push(d)}if(this.isLineLoop){const M=Ts(this,e,Fi,l,g-1,h);M&&t.push(M)}}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}}function Ts(i,e,t,n,s,r){const o=i.geometry.attributes.position;if(Xs.fromBufferAttribute(o,s),Ys.fromBufferAttribute(o,r),t.distanceSqToSegment(Xs,Ys,Vr,ul)>n)return;Vr.applyMatrix4(i.matrixWorld);const l=e.ray.origin.distanceTo(Vr);if(!(l<e.near||l>e.far))return{distance:l,point:ul.clone().applyMatrix4(i.matrixWorld),index:s,face:null,faceIndex:null,barycoord:null,object:i}}const hl=new O,dl=new O;class km extends sr{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)hl.fromBufferAttribute(t,s),dl.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+hl.distanceTo(dl);e.setAttribute("lineDistance",new Tt(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class rr extends Pt{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};const r=[],o=[];a(s),c(n),u(),this.setAttribute("position",new Tt(r,3)),this.setAttribute("normal",new Tt(r.slice(),3)),this.setAttribute("uv",new Tt(o,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function a(b){const y=new O,w=new O,B=new O;for(let I=0;I<t.length;I+=3)h(t[I+0],y),h(t[I+1],w),h(t[I+2],B),l(y,w,B,b)}function l(b,y,w,B){const I=B+1,P=[];for(let F=0;F<=I;F++){P[F]=[];const te=b.clone().lerp(w,F/I),v=y.clone().lerp(w,F/I),E=I-F;for(let W=0;W<=E;W++)W===0&&F===I?P[F][W]=te:P[F][W]=te.clone().lerp(v,W/E)}for(let F=0;F<I;F++)for(let te=0;te<2*(I-F)-1;te++){const v=Math.floor(te/2);te%2===0?(m(P[F][v+1]),m(P[F+1][v]),m(P[F][v])):(m(P[F][v+1]),m(P[F+1][v+1]),m(P[F+1][v]))}}function c(b){const y=new O;for(let w=0;w<r.length;w+=3)y.x=r[w+0],y.y=r[w+1],y.z=r[w+2],y.normalize().multiplyScalar(b),r[w+0]=y.x,r[w+1]=y.y,r[w+2]=y.z}function u(){const b=new O;for(let y=0;y<r.length;y+=3){b.x=r[y+0],b.y=r[y+1],b.z=r[y+2];const w=p(b)/2/Math.PI+.5,B=d(b)/Math.PI+.5;o.push(w,1-B)}g(),_()}function _(){for(let b=0;b<o.length;b+=6){const y=o[b+0],w=o[b+2],B=o[b+4],I=Math.max(y,w,B),P=Math.min(y,w,B);I>.9&&P<.1&&(y<.2&&(o[b+0]+=1),w<.2&&(o[b+2]+=1),B<.2&&(o[b+4]+=1))}}function m(b){r.push(b.x,b.y,b.z)}function h(b,y){const w=b*3;y.x=e[w+0],y.y=e[w+1],y.z=e[w+2]}function g(){const b=new O,y=new O,w=new O,B=new O,I=new Le,P=new Le,F=new Le;for(let te=0,v=0;te<r.length;te+=9,v+=6){b.set(r[te+0],r[te+1],r[te+2]),y.set(r[te+3],r[te+4],r[te+5]),w.set(r[te+6],r[te+7],r[te+8]),I.set(o[v+0],o[v+1]),P.set(o[v+2],o[v+3]),F.set(o[v+4],o[v+5]),B.copy(b).add(y).add(w).divideScalar(3);const E=p(B);M(I,v+0,b,E),M(P,v+2,y,E),M(F,v+4,w,E)}}function M(b,y,w,B){B<0&&b.x===1&&(o[y]=b.x-1),w.x===0&&w.z===0&&(o[y]=B/2/Math.PI+.5)}function p(b){return Math.atan2(b.z,-b.x)}function d(b){return Math.atan2(-b.y,Math.sqrt(b.x*b.x+b.z*b.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new rr(e.vertices,e.indices,e.radius,e.details)}}class sa extends rr{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new sa(e.radius,e.detail)}}class or extends rr{constructor(e=1,t=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],s=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,s,e,t),this.type="OctahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new or(e.radius,e.detail)}}class mc extends Yn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new We(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new We(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Zl,this.normalScale=new Le(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Zt,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class Hm extends qn{constructor(e){super(),this.isLineDashedMaterial=!0,this.type="LineDashedMaterial",this.scale=1,this.dashSize=3,this.gapSize=1,this.setValues(e)}copy(e){return super.copy(e),this.scale=e.scale,this.dashSize=e.dashSize,this.gapSize=e.gapSize,this}}class _c extends ft{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new We(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}}const Wr=new tt,fl=new O,pl=new O;class Gm{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Le(512,512),this.map=null,this.mapPass=null,this.matrix=new tt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ta,this._frameExtents=new Le(1,1),this._viewportCount=1,this._viewports=[new rt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;fl.setFromMatrixPosition(e.matrixWorld),t.position.copy(fl),pl.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(pl),t.updateMatrixWorld(),Wr.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Wr),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Wr)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class Vm extends Gm{constructor(){super(new cc(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class gc extends _c{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(ft.DEFAULT_UP),this.updateMatrix(),this.target=new ft,this.shadow=new Vm}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class Wm extends _c{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}}const ml=new tt;class Xm{constructor(e,t,n=0,s=1/0){this.ray=new tr(e,t),this.near=n,this.far=s,this.camera=null,this.layers=new Qo,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return ml.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(ml),this}intersectObject(e,t=!0,n=[]){return Ho(e,this,n,t),n.sort(_l),n}intersectObjects(e,t=!0,n=[]){for(let s=0,r=e.length;s<r;s++)Ho(e[s],this,n,t);return n.sort(_l),n}}function _l(i,e){return i.distance-e.distance}function Ho(i,e,t,n){let s=!0;if(i.layers.test(e.layers)&&i.raycast(e,t)===!1&&(s=!1),s===!0&&n===!0){const r=i.children;for(let o=0,a=r.length;o<a;o++)Ho(r[o],e,t,!0)}}class gl{constructor(e=1,t=0,n=0){return this.radius=e,this.phi=t,this.theta=n,this}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(Mt(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}class Ym extends km{constructor(e=10,t=10,n=4473924,s=8947848){n=new We(n),s=new We(s);const r=t/2,o=e/t,a=e/2,l=[],c=[];for(let m=0,h=0,g=-a;m<=t;m++,g+=o){l.push(-a,0,g,a,0,g),l.push(g,0,-a,g,0,a);const M=m===r?n:s;M.toArray(c,h),h+=3,M.toArray(c,h),h+=3,M.toArray(c,h),h+=3,M.toArray(c,h),h+=3}const u=new Pt;u.setAttribute("position",new Tt(l,3)),u.setAttribute("color",new Tt(c,3));const _=new qn({vertexColors:!0,toneMapped:!1});super(u,_),this.type="GridHelper"}dispose(){this.geometry.dispose(),this.material.dispose()}}class qm extends Xn{constructor(e,t=null){super(),this.object=e,this.domElement=t,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(){}disconnect(){}dispose(){}update(){}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Xo}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Xo);const vl={type:"change"},ra={type:"start"},vc={type:"end"},As=new tr,xl=new xn,jm=Math.cos(70*Eu.DEG2RAD),ct=new O,yt=2*Math.PI,et={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},Xr=1e-6;class Km extends qm{constructor(e,t=null){super(e,t),this.state=et.NONE,this.enabled=!0,this.target=new O,this.cursor=new O,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:mi.ROTATE,MIDDLE:mi.DOLLY,RIGHT:mi.PAN},this.touches={ONE:fi.ROTATE,TWO:fi.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this._lastPosition=new O,this._lastQuaternion=new Vn,this._lastTargetPosition=new O,this._quat=new Vn().setFromUnitVectors(e.up,new O(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new gl,this._sphericalDelta=new gl,this._scale=1,this._panOffset=new O,this._rotateStart=new Le,this._rotateEnd=new Le,this._rotateDelta=new Le,this._panStart=new Le,this._panEnd=new Le,this._panDelta=new Le,this._dollyStart=new Le,this._dollyEnd=new Le,this._dollyDelta=new Le,this._dollyDirection=new O,this._mouse=new Le,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Zm.bind(this),this._onPointerDown=$m.bind(this),this._onPointerUp=Jm.bind(this),this._onContextMenu=r_.bind(this),this._onMouseWheel=t_.bind(this),this._onKeyDown=n_.bind(this),this._onTouchStart=i_.bind(this),this._onTouchMove=s_.bind(this),this._onMouseDown=Qm.bind(this),this._onMouseMove=e_.bind(this),this._interceptControlDown=o_.bind(this),this._interceptControlUp=a_.bind(this),this.domElement!==null&&this.connect(),this.update()}connect(){this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(vl),this.update(),this.state=et.NONE}update(e=null){const t=this.object.position;ct.copy(t).sub(this.target),ct.applyQuaternion(this._quat),this._spherical.setFromVector3(ct),this.autoRotate&&this.state===et.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let n=this.minAzimuthAngle,s=this.maxAzimuthAngle;isFinite(n)&&isFinite(s)&&(n<-Math.PI?n+=yt:n>Math.PI&&(n-=yt),s<-Math.PI?s+=yt:s>Math.PI&&(s-=yt),n<=s?this._spherical.theta=Math.max(n,Math.min(s,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(n+s)/2?Math.max(n,this._spherical.theta):Math.min(s,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let r=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const o=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),r=o!=this._spherical.radius}if(ct.setFromSpherical(this._spherical),ct.applyQuaternion(this._quatInverse),t.copy(this.target).add(ct),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let o=null;if(this.object.isPerspectiveCamera){const a=ct.length();o=this._clampDistance(a*this._scale);const l=a-o;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),r=!!l}else if(this.object.isOrthographicCamera){const a=new O(this._mouse.x,this._mouse.y,0);a.unproject(this.object);const l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),r=l!==this.object.zoom;const c=new O(this._mouse.x,this._mouse.y,0);c.unproject(this.object),this.object.position.sub(c).add(a),this.object.updateMatrixWorld(),o=ct.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;o!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(o).add(this.object.position):(As.origin.copy(this.object.position),As.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(As.direction))<jm?this.object.lookAt(this.target):(xl.setFromNormalAndCoplanarPoint(this.object.up,this.target),As.intersectPlane(xl,this.target))))}else if(this.object.isOrthographicCamera){const o=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),o!==this.object.zoom&&(this.object.updateProjectionMatrix(),r=!0)}return this._scale=1,this._performCursorZoom=!1,r||this._lastPosition.distanceToSquared(this.object.position)>Xr||8*(1-this._lastQuaternion.dot(this.object.quaternion))>Xr||this._lastTargetPosition.distanceToSquared(this.target)>Xr?(this.dispatchEvent(vl),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e!==null?yt/60*this.autoRotateSpeed*e:yt/60/60*this.autoRotateSpeed}_getZoomScale(e){const t=Math.abs(e*.01);return Math.pow(.95,this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){ct.setFromMatrixColumn(t,0),ct.multiplyScalar(-e),this._panOffset.add(ct)}_panUp(e,t){this.screenSpacePanning===!0?ct.setFromMatrixColumn(t,1):(ct.setFromMatrixColumn(t,0),ct.crossVectors(this.object.up,ct)),ct.multiplyScalar(e),this._panOffset.add(ct)}_pan(e,t){const n=this.domElement;if(this.object.isPerspectiveCamera){const s=this.object.position;ct.copy(s).sub(this.target);let r=ct.length();r*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*r/n.clientHeight,this.object.matrix),this._panUp(2*t*r/n.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/n.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/n.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const n=this.domElement.getBoundingClientRect(),s=e-n.left,r=t-n.top,o=n.width,a=n.height;this._mouse.x=s/o*2-1,this._mouse.y=-(r/a)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(yt*this._rotateDelta.x/t.clientHeight),this._rotateUp(yt*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(yt*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(-yt*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(yt*this.rotateSpeed/this.domElement.clientHeight):this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(-yt*this.rotateSpeed/this.domElement.clientHeight):this._pan(-this.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._rotateStart.set(n,s)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._panStart.set(n,s)}}_handleTouchStartDolly(e){const t=this._getSecondPointerPosition(e),n=e.pageX-t.x,s=e.pageY-t.y,r=Math.sqrt(n*n+s*s);this._dollyStart.set(0,r)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{const n=this._getSecondPointerPosition(e),s=.5*(e.pageX+n.x),r=.5*(e.pageY+n.y);this._rotateEnd.set(s,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(yt*this._rotateDelta.x/t.clientHeight),this._rotateUp(yt*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._panEnd.set(n,s)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){const t=this._getSecondPointerPosition(e),n=e.pageX-t.x,s=e.pageY-t.y,r=Math.sqrt(n*n+s*s);this._dollyEnd.set(0,r),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const o=(e.pageX+t.x)*.5,a=(e.pageY+t.y)*.5;this._updateZoomParameters(o,a)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new Le,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){const t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){const t=e.deltaMode,n={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:n.deltaY*=16;break;case 2:n.deltaY*=100;break}return e.ctrlKey&&!this._controlActive&&(n.deltaY*=10),n}}function $m(i){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(i.pointerId),this.domElement.addEventListener("pointermove",this._onPointerMove),this.domElement.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(i)&&(this._addPointer(i),i.pointerType==="touch"?this._onTouchStart(i):this._onMouseDown(i)))}function Zm(i){this.enabled!==!1&&(i.pointerType==="touch"?this._onTouchMove(i):this._onMouseMove(i))}function Jm(i){switch(this._removePointer(i),this._pointers.length){case 0:this.domElement.releasePointerCapture(i.pointerId),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(vc),this.state=et.NONE;break;case 1:const e=this._pointers[0],t=this._pointerPositions[e];this._onTouchStart({pointerId:e,pageX:t.x,pageY:t.y});break}}function Qm(i){let e;switch(i.button){case 0:e=this.mouseButtons.LEFT;break;case 1:e=this.mouseButtons.MIDDLE;break;case 2:e=this.mouseButtons.RIGHT;break;default:e=-1}switch(e){case mi.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(i),this.state=et.DOLLY;break;case mi.ROTATE:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=et.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=et.ROTATE}break;case mi.PAN:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=et.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=et.PAN}break;default:this.state=et.NONE}this.state!==et.NONE&&this.dispatchEvent(ra)}function e_(i){switch(this.state){case et.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(i);break;case et.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(i);break;case et.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(i);break}}function t_(i){this.enabled===!1||this.enableZoom===!1||this.state!==et.NONE||(i.preventDefault(),this.dispatchEvent(ra),this._handleMouseWheel(this._customWheelEvent(i)),this.dispatchEvent(vc))}function n_(i){this.enabled===!1||this.enablePan===!1||this._handleKeyDown(i)}function i_(i){switch(this._trackPointer(i),this._pointers.length){case 1:switch(this.touches.ONE){case fi.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(i),this.state=et.TOUCH_ROTATE;break;case fi.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(i),this.state=et.TOUCH_PAN;break;default:this.state=et.NONE}break;case 2:switch(this.touches.TWO){case fi.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(i),this.state=et.TOUCH_DOLLY_PAN;break;case fi.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(i),this.state=et.TOUCH_DOLLY_ROTATE;break;default:this.state=et.NONE}break;default:this.state=et.NONE}this.state!==et.NONE&&this.dispatchEvent(ra)}function s_(i){switch(this._trackPointer(i),this.state){case et.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(i),this.update();break;case et.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(i),this.update();break;case et.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(i),this.update();break;case et.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(i),this.update();break;default:this.state=et.NONE}}function r_(i){this.enabled!==!1&&i.preventDefault()}function o_(i){i.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function a_(i){i.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}class l_ extends ft{constructor(e=document.createElement("div")){super(),this.isCSS2DObject=!0,this.element=e,this.element.style.position="absolute",this.element.style.userSelect="none",this.element.setAttribute("draggable",!1),this.center=new Le(.5,.5),this.addEventListener("removed",function(){this.traverse(function(t){t.element instanceof Element&&t.element.parentNode!==null&&t.element.parentNode.removeChild(t.element)})})}copy(e,t){return super.copy(e,t),this.element=e.element.cloneNode(!0),this.center=e.center,this}}const di=new O,Ml=new tt,Sl=new tt,yl=new O,El=new O;class c_{constructor(e={}){const t=this;let n,s,r,o;const a={objects:new WeakMap},l=e.element!==void 0?e.element:document.createElement("div");l.style.overflow="hidden",this.domElement=l,this.getSize=function(){return{width:n,height:s}},this.render=function(g,M){g.matrixWorldAutoUpdate===!0&&g.updateMatrixWorld(),M.parent===null&&M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),Ml.copy(M.matrixWorldInverse),Sl.multiplyMatrices(M.projectionMatrix,Ml),u(g,g,M),h(g)},this.setSize=function(g,M){n=g,s=M,r=n/2,o=s/2,l.style.width=g+"px",l.style.height=M+"px"};function c(g){g.isCSS2DObject&&(g.element.style.display="none");for(let M=0,p=g.children.length;M<p;M++)c(g.children[M])}function u(g,M,p){if(g.visible===!1){c(g);return}if(g.isCSS2DObject){di.setFromMatrixPosition(g.matrixWorld),di.applyMatrix4(Sl);const d=di.z>=-1&&di.z<=1&&g.layers.test(p.layers)===!0,b=g.element;b.style.display=d===!0?"":"none",d===!0&&(g.onBeforeRender(t,M,p),b.style.transform="translate("+-100*g.center.x+"%,"+-100*g.center.y+"%)translate("+(di.x*r+r)+"px,"+(-di.y*o+o)+"px)",b.parentNode!==l&&l.appendChild(b),g.onAfterRender(t,M,p));const y={distanceToCameraSquared:_(p,g)};a.objects.set(g,y)}for(let d=0,b=g.children.length;d<b;d++)u(g.children[d],M,p)}function _(g,M){return yl.setFromMatrixPosition(g.matrixWorld),El.setFromMatrixPosition(M.matrixWorld),yl.distanceToSquared(El)}function m(g){const M=[];return g.traverseVisible(function(p){p.isCSS2DObject&&M.push(p)}),M}function h(g){const M=m(g).sort(function(d,b){if(d.renderOrder!==b.renderOrder)return b.renderOrder-d.renderOrder;const y=a.objects.get(d).distanceToCameraSquared,w=a.objects.get(b).distanceToCameraSquared;return y-w}),p=M.length;for(let d=0,b=M.length;d<b;d++)M[d].element.style.zIndex=p-d}}}function ws(i){let e=0;for(const t of i){const n=t.geometry;n!==void 0&&(n.dispose(),e+=1)}return e}const Yr=6e4;function u_(i,e,t=Date.now){let n=-Yr;return{fault(s){const r=t();r-n>=Yr&&(e(`[nexus] ${s}`),n=r),i.show(s)},clear(){i.hide(),n=-Yr}}}const h_={bg0:"#060a12"},bl={nodeLive:4906624,nodeCold:4871528},Tl=[9133302,3900150,1357990,16096779,15485081,8702998];function xc(){return typeof window<"u"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches}function d_(i,e,t){const n=i.filter(r=>r.live!==!1).length,s=i.length-n;return"A2A 拓扑："+i.length+" 个节点（"+n+" live / "+s+" cold），"+e.length+" 个团队，"+t.length+" 个联邦对端"}const f_=new qn({color:2282478,transparent:!0,opacity:.18}),p_=new ea({color:2282478,transparent:!0,opacity:.5}),m_=new or(.35,0);new qn({color:16096779,transparent:!0,opacity:.65});const __=new mc({color:6514417,emissive:6514417,emissiveIntensity:.5,transparent:!0,opacity:.75}),g_=new or(1.3,0),v_=new Hm({color:6514417,dashSize:1.2,gapSize:.8,transparent:!0,opacity:.35});function x_(i,e,t,n){for(const s of i){const r=s.members.filter(l=>e.has(l.id));if(r.length<2)continue;const o=new O;for(const l of r)o.add(e.get(l.id).position);o.divideScalar(r.length);const a=new Ft(m_,p_);a.position.copy(o),a.userData={team:s.name},n.add(a);for(const l of r){const c=new Pt().setFromPoints([o,e.get(l.id).position.clone()]);t.add(new sr(c,f_))}}}function M_(i,e,t){i.forEach((n,s)=>{const r=n.url.replace(/^\w+:\/\//,""),o=new Ft(g_,__);o.position.set(-20-s*10,14+s%2*6,-12-s*6),o.userData={label:"Peer: "+r,kind:"peer",peer:r},e.add(o);const a=new Pt().setFromPoints([new O(0,-4,0),o.position.clone()]),l=new sr(a,v_);l.computeLineDistances(),t.add(l)})}const Al=18;function S_(i){const e=i.includes("/")?i.slice(i.lastIndexOf("/")+1):i;return e.length<=Al?e:e.slice(0,Al)+"…"}function y_(i,e,t,n){const s=document.createElement("div");s.className="nexus-label "+(t?"live":"cold");const r=document.createElement("span");r.className="nm",r.textContent=S_(e);const o=document.createElement("span");o.className="sub",o.textContent=(t?"live":"cold")+" · "+n,s.append(r,o);const a=new l_(s);return a.position.set(0,1.6,0),i.add(a),a}function E_(i){i.removeFromParent()}let Mn=null;function Mc(i,e){Mn||(Mn=document.createElement("div"),Mn.className="nexus-inspector",i.appendChild(Mn)),Mn.textContent=e,Mn.style.display="block"}function oa(){Mn&&(Mn.style.display="none")}function b_(i,e){i.setAttribute("aria-label",e)}function T_(i,e,t,n){b_(i,d_(e,t,n))}function A_(i,e){return t=>{if(t.key==="Escape"){i.escape(),e.focus();return}if(t.key==="Enter"||t.key==="Tab"){t.preventDefault();const n=i.nextAfter(i.pinned());n!==void 0&&i.pin(n)}}}function w_(i,e){let t=0;return i.addEventListener("change",()=>{e()}),{isTicking:()=>!1,renderOnceCount:()=>t,renderOnce:()=>{t+=1,e()}}}const En=1e6,aa=.25,la=3,Sc=256,yc=96;function wi(i){const e=typeof i=="number"?i:Number.NaN;if(Number.isFinite(e))return Math.max(-En,Math.min(En,Math.round(e)))}function Ec(i){if(i===null||typeof i!="object")return;const e=i,t=wi(e.x),n=wi(e.y);return t===void 0||n===void 0?void 0:{x:t,y:n}}function R_(i){const e=Ec(i);if(e===void 0)return;const t=i,n=wi(t.w),s=wi(t.h);if(!(n===void 0||s===void 0||n<=0||s<=0))return{...e,w:Math.min(n,En),h:Math.min(s,En)}}function bc(i){if(i===null||typeof i!="object")return;const e=i;if(e.version!==1)return;const t=e.viewport;if(t===null||typeof t!="object")return;const n=t,s=wi(n.x),r=wi(n.y),o=n.scale,a=typeof o=="number"?o:Number.NaN;if(s===void 0||r===void 0||!Number.isFinite(a))return;const l=Math.max(aa,Math.min(la,a)),c={};if(e.nodes!==null&&typeof e.nodes=="object")for(const[_,m]of Object.entries(e.nodes)){if(typeof _!="string"||_===""||_.length>128)continue;const h=Ec(m);if(h!==void 0&&(c[_]=h),Object.keys(c).length>=Sc)break}const u={};if(e.frames!==null&&typeof e.frames=="object")for(const[_,m]of Object.entries(e.frames)){if(typeof _!="string"||_===""||_.includes("/")||_.length>40)continue;const h=R_(m);if(h!==void 0&&(u[_]=h),Object.keys(u).length>=yc)break}return{version:1,viewport:{x:s,y:r,scale:l},nodes:c,frames:u}}function C_(i,e,t){const n=o=>Math.max(-En,Math.min(En,Math.round(o))),s={};for(const[o,a]of e)if(!(typeof o!="string"||o===""||o.length>128)&&(s[o]={x:n(a.x),y:n(a.y)},Object.keys(s).length>=Sc))break;const r={};for(const[o,a]of t){if(typeof o!="string"||o===""||o.includes("/")||o.length>40)continue;const l=n(a.w),c=n(a.h);if(!(l<=0||c<=0)&&(r[o]={x:n(a.x),y:n(a.y),w:Math.min(l,En),h:Math.min(c,En)},Object.keys(r).length>=yc))break}return{version:1,viewport:{x:n(i.x),y:n(i.y),scale:Math.max(aa,Math.min(la,i.scale))},nodes:s,frames:r}}const wl=12,P_=30,Rl=1;function Tc(i){let e=2166136261;for(let t=0;t<i.length;t++)e^=i.charCodeAt(t),e=Math.imul(e,16777619)>>>0;return e>>>0}function L_(i){const e=Tc(i),t=e%3600/3600*Math.PI*2,n=wl+(e>>>9)%1800/1800*(P_-wl),s=(e>>>18)%2e3/1999*2*Rl-Rl;return{x:Math.cos(t)*n,y:s,z:Math.sin(t)*n}}const Cl=172,Go=56,Pl=[150,290,430],Rs=16;function Ac(i){const e=Tc(i),t=Math.floor(e/Rs)%Pl.length,s=e%Rs/Rs*Math.PI*2+t*(Math.PI/Rs),r=Pl[t];return{x:Math.round(Math.cos(s)*r),y:Math.round(Math.sin(s)*r*.6)}}function xi(i){return{x:i.x-Cl/2,y:i.y-Go/2,w:Cl,h:Go}}function ca(i){if(i.length===0)return{x:0,y:0,w:260,h:160};let e=Number.POSITIVE_INFINITY,t=Number.POSITIVE_INFINITY,n=Number.NEGATIVE_INFINITY,s=Number.NEGATIVE_INFINITY;for(const u of i)e=Math.min(e,u.x),t=Math.min(t,u.y),n=Math.max(n,u.x+u.w),s=Math.max(s,u.y+u.h);const r=24,o=44,a=24,l=Math.max(260,Math.round(n-e+r*2)),c=Math.max(160,Math.round(s-t+o+a));return{x:Math.round(e-r),y:Math.round(t-o),w:l,h:c}}class ua{constructor(){Zn(this,"revisionCounter",0);Zn(this,"nodes",new Map);Zn(this,"frames",new Map);Zn(this,"selection",new Set);Zn(this,"viewport",{x:0,y:0,scale:1})}get revision(){return this.revisionCounter}getNode(e){return this.nodes.get(e)}allNodes(){return[...this.nodes.values()]}nodeIds(){return[...this.nodes.keys()]}getFrame(e){return this.frames.get(e)}allFrames(){return[...this.frames.entries()]}isSelected(e){return this.selection.has(e)}selectedIds(){return[...this.selection]}bump(){this.revisionCounter+=1}dragNodes(e,t,n){let s=!1;for(const r of e){const o=this.nodes.get(r);o!==void 0&&(o.x+=t,o.y+=n,s=!0)}s&&this.bump()}beginFrameDrag(e){const t=this.frames.get(e);if(t===void 0)return;const n=[];for(const s of this.nodes.values())for(const r of s.memberships)if(r.team===e){n.push([s.id,s.x,s.y]);break}return{name:e,rect:{...t},centers:n}}applyFrameDrag(e,t,n){const s=this.frames.get(e.name);if(s!==void 0){s.x=e.rect.x+t,s.y=e.rect.y+n;for(const[r,o,a]of e.centers){const l=this.nodes.get(r);l!==void 0&&(l.x=o+t,l.y=a+n)}this.bump()}}nudge(e,t,n){this.dragNodes(e,t,n)}marqueeSelect(e,t){t||this.selection.clear();for(const n of this.nodes.values()){const s=xi(n);s.x<e.x+e.w&&s.x+s.w>e.x&&s.y<e.y+e.h&&s.y+s.h>e.y&&this.selection.add(n.id)}this.bump()}setSelection(e){this.selection=new Set(e),this.bump()}upsertNode(e){const t=this.nodes.get(e.id);if(t===void 0){this.nodes.set(e.id,e),this.bump();return}t.label=e.label,t.name=e.name,t.live=e.live,t.memberships=e.memberships,this.bump()}removeNode(e){this.nodes.delete(e)&&(this.selection.delete(e),this.bump())}setFrame(e,t){this.frames.set(e,t),this.bump()}removeFrame(e){this.frames.delete(e)&&this.bump()}upsertScore(e,t){const n=this.nodes.get(e);n===void 0||n.score===t||(n.score=t,this.bump())}positions(){const e=new Map;for(const[t,n]of this.nodes)e.set(t,{x:n.x,y:n.y});return e}frameRects(){const e=new Map;for(const[t,n]of this.frames)e.set(t,{...n});return e}teamMemberIds(e){const t=[];for(const n of this.nodes.values()){const s=n.memberships.find(r=>r.team===e);s!==void 0&&t.push({id:n.id,index:s.index})}return t.sort((n,s)=>n.index-s.index).map(n=>n.id)}setTeamMembers(e,t){for(const n of this.nodes.values()){const s=n.memberships.filter(o=>o.team!==e),r=t.indexOf(n.id);r>=0&&s.push({team:e,index:r}),n.memberships=s}this.bump()}contentBounds(){let e=Number.POSITIVE_INFINITY,t=Number.POSITIVE_INFINITY,n=Number.NEGATIVE_INFINITY,s=Number.NEGATIVE_INFINITY;const r=o=>{e=Math.min(e,o.x),t=Math.min(t,o.y),n=Math.max(n,o.x+o.w),s=Math.max(s,o.y+o.h)};for(const o of this.nodes.values())o.remote!==!0&&r(xi(o));for(const o of this.frames.values())r(o);return e===Number.POSITIVE_INFINITY?null:{minX:e,minY:t,maxX:n,maxY:s}}static fromState(e){const t=new ua,n=bc(e.layout),s=new Map;for(const r of e.teams)for(let o=0;o<r.members.length;o++){const a=r.members[o].id,l=s.get(a)??[];l.push({team:r.name,index:o}),s.set(a,l)}for(const r of e.sessions){if(r.joined!==!0)continue;const o=n==null?void 0:n.nodes[r.id];let a,l;if(o!==void 0&&typeof o.x=="number"&&typeof o.y=="number")a=o.x,l=o.y;else{const c=Ac(r.id);a=c.x,l=c.y}t.nodes.set(r.id,{id:r.id,x:a,y:l,label:r.label,team:r.team,name:r.name,live:r.live!==!1,memberships:s.get(r.id)??[]})}for(const r of e.teams){const o=n==null?void 0:n.frames[r.name];if(o!==void 0){t.frames.set(r.name,{x:o.x,y:o.y,w:o.w,h:o.h});continue}const a=[];for(const l of r.members){const c=t.nodes.get(l.id);c!==void 0&&a.push(xi(c))}a.length>0&&t.frames.set(r.name,ca(a))}return t.viewport=n!==void 0?{...n.viewport}:{x:0,y:0,scale:1},t}}const D_=24,I_=-13,wc=I_+D_;function N_(i,e,t){const n=[],s=new Set;for(const r of i){const o=e.get(r.name);if(o===void 0)continue;const a=o.x+o.w/2,l=o.y+wc;for(const c of r.members){const u=t.get(c.id);if(u===void 0)continue;const _=s.has(c.id);s.add(c.id),n.push({x1:a,y1:l,x2:u.x,y2:u.y-Go/2,dashed:_,team:r.name,id:c.id})}}return n}function Vo(i){return i.name??i.team??i.label??""}function U_(i){return`peer-${ha(i).replace(/[^A-Za-z0-9.:\[\]-]/g,"-")}`}function ha(i){try{return new URL(i).host}catch{return i}}function F_(i){const e=new Map;for(const t of i){const n=t.via!==void 0&&t.via!==""?ha(t.via):"",s=e.get(n)??[];s.push(t),e.set(n,s)}return e}const O_=140,B_=200,z_=90,k_=20,Cs=60;function H_(i,e){const t=e!==null?e.maxX+O_:B_,n=e!==null?e.minY:0;return i.map((s,r)=>({url:s.url,score:s.score,x:t,y:n+r*z_}))}function G_(i,e,t,n){const s=new Map;for(const o of i){if(!e.has(o.team))continue;const a=`${o.team}\0${o.peer}`,l=s.get(a);l===void 0?s.set(a,{team:o.team,peer:o.peer,startedAt:o.startedAt,count:1}):(l.startedAt=Math.min(l.startedAt,o.startedAt),l.count+=1)}const r=[];for(const o of s.values()){const a=e.get(o.team);if(a===void 0)continue;const l=t.find(u=>{try{return new URL(u.url).host===o.peer}catch{return!1}});if(l===void 0)continue;const c=Math.max(0,Math.round((n-o.startedAt)/1e3));r.push({x1:a.x,y1:a.y,x2:l.x,y2:l.y,label:`a2a_route · ${o.peer} · ${c}s`+(o.count>1?` ×${o.count}`:"")})}return r}function V_(i,e){const t=e!==null?{x:e.maxX+k_,y:i.length>0?(i[0].y+i[i.length-1].y)/2:(e.minY+e.maxY)/2}:{x:-80,y:0};return i.map((n,s)=>({x1:t.x,y1:t.y,x2:n.x,y2:n.y,label:s===0?"gns referral":""}))}function W_(i,e){if(i===null&&e.length===0)return null;let t=i!==null?i.minX:Number.POSITIVE_INFINITY,n=i!==null?i.minY:Number.POSITIVE_INFINITY,s=i!==null?i.maxX:Number.NEGATIVE_INFINITY,r=i!==null?i.maxY:Number.NEGATIVE_INFINITY;for(const o of e)t=Math.min(t,o.x-Cs),n=Math.min(n,o.y-Cs),s=Math.max(s,o.x+Cs),r=Math.max(r,o.y+Cs);return{minX:t,minY:n,maxX:s,maxY:r}}const Ll={x:0,y:0,scale:1};function da(i){return Math.max(aa,Math.min(la,i))}function qr(i){const e=Number.isFinite(i.scale)?i.scale:1,t=Number.isFinite(i.x)?i.x:0,n=Number.isFinite(i.y)?i.y:0;return{x:t,y:n,scale:da(e)}}function Un(i,e,t){return{x:i.x+e/i.scale,y:i.y+t/i.scale}}function jr(i,e,t){return{x:i.x+e/i.scale,y:i.y+t/i.scale,scale:i.scale}}function Dl(i,e,t,n){const s=da(i.scale*e);return s===i.scale?i:{x:i.x+t/i.scale-t/s,y:i.y+n/i.scale-n/s,scale:s}}function Il(i,e,t){if(i===null||e<=0||t<=0)return Ll;const n=i.maxX-i.minX,s=i.maxY-i.minY;if(!(n>0)||!(s>0))return Ll;const r=da(.9*Math.min(e/n,t/s));return{x:(i.minX+i.maxX)/2-e/(2*r),y:(i.minY+i.maxY)/2-t/(2*r),scale:r}}function X_(i){return`translate(${-i.x*i.scale}px, ${-i.y*i.scale}px) scale(${i.scale})`}function Y_(i){return i.type==="join-network"||i.type==="leave-network"?"$network":i.type==="create-team"||i.type==="remove-team"?i.name:i.team}function q_(i,e){if(e.type==="create-team"){const s=e.ids.map(r=>i.getNode(r)).filter(r=>r!==void 0).map(r=>xi(r));return i.setFrame(e.name,ca(s)),i.setTeamMembers(e.name,e.ids),()=>{i.setTeamMembers(e.name,i.teamMemberIds(e.name).filter(r=>!e.ids.includes(r))),i.removeFrame(e.name)}}if(e.type==="add-member"){const s=i.teamMemberIds(e.team),r=e.ids.filter(o=>!s.includes(o));return i.setTeamMembers(e.team,[...s,...r]),()=>{i.setTeamMembers(e.team,i.teamMemberIds(e.team).filter(o=>!r.includes(o)))}}if(e.type==="remove-member"){const s=i.teamMemberIds(e.team);return i.setTeamMembers(e.team,s.filter(r=>!e.ids.includes(r))),()=>{const r=i.teamMemberIds(e.team);i.setTeamMembers(e.team,[...r,...e.ids.filter(o=>!r.includes(o))])}}if(e.type==="remove-team"){const s=i.teamMemberIds(e.name),r=i.getFrame(e.name),o=r!==void 0?{...r}:void 0;return i.setTeamMembers(e.name,[]),i.removeFrame(e.name),()=>{o!==void 0&&i.setFrame(e.name,o),i.setTeamMembers(e.name,s)}}if(e.type==="join-network"||e.type==="leave-network")return()=>{};const t=i.teamMemberIds(e.team);let n=[...t];for(const s of e.ops)s.op==="remove"?n=n.filter(r=>r!==s.id):n.push(s.id);return i.setTeamMembers(e.team,n),()=>{let s=i.teamMemberIds(e.team);for(let r=0;r<t.length;r++){const o=t[r];s[r]!==o&&s.includes(o)&&(s=s.filter(a=>a!==o),s.push(o))}i.setTeamMembers(e.team,s)}}function Kr(i,e){const t=[...i],n=[];for(let s=0;s<e.length;s++){const r=e[s];t[s]!==r&&t.includes(r)&&(n.push({op:"remove",id:r}),n.push({op:"add",id:r}),t.splice(t.indexOf(r),1),t.push(r))}return n}function j_(i,e){return i.teamMemberIds(e).map(t=>{var n;return{id:t,y:((n=i.getNode(t))==null?void 0:n.y)??0}}).sort((t,n)=>t.y-n.y).map(t=>t.id)}function Nl(i,e){let t,n=Number.POSITIVE_INFINITY;for(const[s,r]of i){if(e.x<r.x||e.x>r.x+r.w||e.y<r.y||e.y>r.y+r.h)continue;const o=r.w*r.h;o<n&&(t=s,n=o)}return t}function K_(i){let e=0;for(let a=0;a<i.length;a++)e=(e*31+i.charCodeAt(a)&268435455)>>>0;const t=Tl[e%Tl.length],n="#"+t.toString(16).padStart(6,"0"),s=t>>16&255,r=t>>8&255,o=t&255;return{line:n,bg:`rgba(${s},${r},${o},0.05)`}}function $_(i){const e=new ua;let t,n={...e.viewport},s={kind:"none"},r=!1,o=-1;const a=i.now??Date.now,l=new AbortController,c=[];let u=null,_=!1;const m={signal:l.signal},h=document.createElement("section");h.id="dsh-plan",h.setAttribute("role","tabpanel"),h.setAttribute("aria-label","A2A 规划画布"),h.tabIndex=0,h.style.display="none";const g=document.createElement("div");g.className="p-grid";const M=document.createElement("div");M.className="p-world";const p=document.createElementNS("http://www.w3.org/2000/svg","svg");p.setAttribute("class","p-edges");const d=document.createElement("div");d.className="p-layer p-frames";const b=document.createElement("div");b.className="p-layer p-nodes",b.setAttribute("role","listbox"),b.setAttribute("aria-multiselectable","true"),b.setAttribute("aria-label","会话节点"),M.append(p,d,b);const y=document.createElement("div");y.className="p-marquee";const w=document.createElement("div");w.className="p-toolbar";const B=document.createElement("span");B.className="p-zoom mono",B.textContent="100%";const I=(R,U,f)=>{const S=document.createElement("button");return S.type="button",S.textContent=R,S.title=U,S.addEventListener("click",f,m),S};w.append(I("适配(0)","适配视图（0）",()=>mt()),I("－","缩小",()=>Ve(1/1.2)),B,I("＋","放大",()=>Ve(1.2)),I("建队","组成团队（G）：先框选至少 2 个节点",()=>ue()));const P=I("未入网","未入网会话（点击选择入网）",()=>Ie());P.className="p-netbtn",P.setAttribute("aria-haspopup","menu"),w.appendChild(P);const F=document.createElement("span");F.setAttribute("aria-live","polite"),F.className="p-lamp";const te=document.createElement("i"),v=document.createElement("span");v.textContent="布局",F.append(te,v),F.addEventListener("click",()=>{F.classList.contains("error")&&i.onLampClick()},m),F.addEventListener("keydown",R=>{const U=R;(U.key==="Enter"||U.key===" ")&&F.classList.contains("error")&&(U.preventDefault(),i.onLampClick())},m),w.appendChild(F);const E=document.createElement("div");E.className="p-status";const W=document.createElement("span"),V=document.createElement("span"),Z=document.createElement("span");Z.className="mut";const ie=document.createElement("span");ie.className="mut",E.append(W,V,Z,ie),E.tabIndex=0,E.setAttribute("role","button"),E.setAttribute("aria-label","定位在途路由与联邦对端"),E.title="定位在途与联邦（回车）",E.addEventListener("click",()=>Pe(),m),E.addEventListener("keydown",R=>{const U=R;(U.key==="Enter"||U.key===" ")&&(U.preventDefault(),Pe())},m);const X=document.createElement("div");X.className="p-legend";const ne=(R,U,f)=>{const S=document.createElement("span"),L=document.createElement("i");R&&(L.className="dashed"),f!==void 0&&(L.style.borderTopColor=f),S.append(L,document.createTextNode(U)),X.appendChild(S)};ne(!1,"成员边（星形，框→成员）"),ne(!0,"跨队多属（虚线）"),ne(!1,"活动边（inFlight 路由，瞬时）","var(--accent)"),ne(!0,"联邦线（→peer）","var(--federal)");const G=document.createElement("div");G.className="p-notice-stack",G.setAttribute("role","log"),G.setAttribute("aria-live","polite"),h.append(g,M,y,w,E,X,G);let _e=0,ve=0;const ye=()=>i.viewSize?i.viewSize():{w:h.clientWidth,h:h.clientHeight},He=()=>{const R=ye();_e=R.w,ve=R.h};function Be(){M.style.transform=X_(n);const R=24*n.scale;g.style.backgroundSize=`${R}px ${R}px`,g.style.backgroundPosition=`${-n.x*n.scale}px ${-n.y*n.scale}px`,B.textContent=`${Math.round(n.scale*100)}%`}function Y(){Be(),e.revision!==o&&(o=e.revision,Se(),Xe(),$e()),Ce()}const re=new Map,Me=new Map;function Se(){const R=new Set;for(const[U,f]of e.allFrames()){R.add(U);let S=re.get(U);if(S===void 0){S=document.createElement("div"),S.className="p-frame",S.dataset.name=U;const he=document.createElement("div");he.className="p-frame-head",he.dataset.frame=U,he.tabIndex=0,he.setAttribute("role","button"),he.setAttribute("aria-haspopup","menu"),he.setAttribute("aria-label",`团队框 ${U}（拖动整组，回车菜单）`);const oe=document.createElement("span");oe.className="ttl";const ae=document.createElement("span");ae.className="cnt mono";const Te=document.createElement("span");Te.className="route mono",he.append(oe,ae,Te),S.appendChild(he),d.appendChild(S),re.set(U,S)}const L=K_(U);S.style.setProperty("--frame-line",L.line),S.style.setProperty("--frame-bg",L.bg),S.style.left=`${f.x}px`,S.style.top=`${f.y}px`,S.style.width=`${f.w}px`,S.style.height=`${f.h}px`;const T=S.querySelector(".ttl"),C=S.querySelector(".cnt"),k=S.querySelector(".route");T.textContent!==U&&(T.textContent=U);let q=0,$=0;for(const he of e.allNodes())he.memberships.find(ae=>ae.team===U)!==void 0&&(q+=1,he.memberships.length>1&&($+=1));const ee=`${q} 成员`+($>0?` +${$} 跨队`:"");C.textContent!==ee&&(C.textContent=ee);const le=Re(U);k.textContent!==le&&(k.textContent=le)}for(const[U,f]of[...re])R.has(U)||(f.remove(),re.delete(U))}function De(R){const U=_t.get(R)??[],f=U.map(C=>C.name!==void 0&&C.name!==""?C.name:C.team),S=f.slice(0,2).join("、"),L=f.length>2?` +${f.length-2}`:"",T=ke.get(R);return(T!==void 0?`score ${T} · `:"")+`${U.length} 远端团队`+(S!==""?`：${S}${L}`:"")}function Re(R){const U=hn.find(f=>f.name===R);return(U==null?void 0:U.team)??R}function Xe(){const R=new Set;for(const U of e.allNodes()){R.add(U.id);let f=Me.get(U.id);if(f===void 0){f=document.createElement("div"),f.className="p-node",f.dataset.id=U.id,f.tabIndex=0;const he=document.createElement("div");he.className="nm";const oe=document.createElement("span");oe.className="dot";const ae=document.createElement("span");ae.className="nm-text",he.append(oe,ae);const Te=document.createElement("div");Te.className="sub mono";const Ne=document.createElement("span");Ne.className="prio mono",f.append(he,Te,Ne),b.appendChild(f),Me.set(U.id,f)}const S=xi(U);f.style.left=`${S.x}px`,f.style.top=`${S.y}px`,f.classList.toggle("cold",!U.live),f.classList.toggle("remote",U.remote===!0),f.classList.toggle("selected",e.isSelected(U.id)),f.setAttribute("aria-selected",String(e.isSelected(U.id)));const L=U.id.slice(5),T=U.remote===!0?L:Vo(U),C=f.querySelector(".nm-text");C.textContent!==T&&(C.textContent=T);const k=f.querySelector(".sub"),q=U.team+(U.name!==void 0&&U.name!==""?" · "+U.name:""),$=U.remote===!0?De(L):(q===T?"":q)+(U.memberships.length>1?` · 跨队×${U.memberships.length}`:"");k.textContent!==$&&(k.textContent=$);const ee=f.querySelector(".prio"),le=U.remote===!0?"peer":U.memberships[0]!==void 0?`P${U.memberships[0].index}`:"";ee.textContent!==le&&(ee.textContent=le)}for(const[U,f]of[...Me])R.has(U)||(f.remove(),Me.delete(U))}function $e(){for(;p.firstChild!==null;)p.firstChild.remove();const R=e.allFrames().map(([U])=>({name:U,members:e.teamMemberIds(U).map(f=>({id:f}))}));for(const U of N_(R,new Map(e.allFrames()),e.positions())){const f=document.createElementNS("http://www.w3.org/2000/svg","line");f.setAttribute("class","e-member"+(U.dashed?" dashed":"")),f.setAttribute("x1",String(U.x1)),f.setAttribute("y1",String(U.y1)),f.setAttribute("x2",String(U.x2)),f.setAttribute("y2",String(U.y2)),p.appendChild(f)}}let ze=[],D=[],_t=new Map;const ke=new Map;let Ye=[];function Ce(){for(const f of ze)f.remove();ze=[];const R=e.allNodes().filter(f=>f.remote===!0).map(f=>({url:f.peerUrl??f.id.slice(5),score:f.score,x:f.x,y:f.y}));D=R;const U=e.contentBounds();if(U!==null){const f=new Map;for(const[S,L]of e.allFrames())f.set(S,{name:S,x:L.x+L.w/2,y:L.y+wc});for(const S of G_(Ye,f,R,a()))ze.push(...Qe(S,"e-activity",S.label));for(const S of V_(R,U))ze.push(...Qe(S,"e-federal",S.label))}}function Qe(R,U,f){const S=document.createElementNS("http://www.w3.org/2000/svg","line");S.setAttribute("class",U),S.setAttribute("x1",String(R.x1)),S.setAttribute("y1",String(R.y1)),S.setAttribute("x2",String(R.x2)),S.setAttribute("y2",String(R.y2)),p.appendChild(S);const L=[S];if(f!==""){const T=document.createElementNS("http://www.w3.org/2000/svg","text");T.setAttribute("class","edge-label mono"),T.setAttribute("x",String((R.x1+R.x2)/2+14)),T.setAttribute("y",String((R.y1+R.y2)/2+18)),T.textContent=f,p.appendChild(T),L.push(T)}return L}function Pe(){n=Il(W_(e.contentBounds(),D),h.clientWidth||_e,h.clientHeight||ve),Be(),i.onDirty()}function A(R){var T;const U=R.sessions.filter(C=>C.live!==!1).length,f=R.sessions.length-U;W.textContent="";const S=document.createElement("b");S.className="ok",S.textContent=`● ${U} live`,W.appendChild(S),V.textContent="";const L=document.createElement("b");L.className="warn",L.textContent=`● ${f} cold`,V.appendChild(L),Z.textContent=`${((T=R.inFlight)==null?void 0:T.length)??0} inFlight`,ie.className="mut",ie.textContent=`${R.teams.length} 队 · ${R.peerCount} peer`}const x=new Map,z=R=>{x.set(R,(x.get(R)??0)+1)},K=R=>{const U=(x.get(R)??0)-1;U<=0?x.delete(R):x.set(R,U)};function J(R){const U=q_(e,R),f=Y_(R);z(f),Y(),i.onCanvasAction(R).then(S=>{K(f),S||U(),Y()},()=>{K(f),U(),j("error","操作通道异常，已回滚"),Y()})}function j(R,U){var S;for(;G.childElementCount>=3;)(S=G.firstElementChild)==null||S.remove();const f=document.createElement("div");f.className="p-notice"+(R==="error"?" error":""),f.setAttribute("role",R==="error"?"alert":"status"),f.textContent=U,G.appendChild(f),c.push(setTimeout(()=>f.remove(),4e3))}function Ee(){return e.selectedIds().map(R=>{var U;return{id:R,y:((U=e.getNode(R))==null?void 0:U.y)??0}}).sort((R,U)=>R.y-U.y).map(R=>R.id)}function ue(){if(pe!==null)return;const R=Ee().filter(U=>{var f;return((f=e.getNode(U))==null?void 0:f.remote)!==!0});if(R.length<2){j("info","框选至少 2 个会话节点");return}qe(R)}let pe=null;function qe(R){const U=document.createElement("div");U.className="p-dialog";const f=document.createElement("div");f.className="p-dialog-panel",f.setAttribute("role","dialog"),f.setAttribute("aria-modal","true"),f.setAttribute("aria-labelledby","p-dialog-title");const S=document.createElement("div");S.id="p-dialog-title",S.className="p-dialog-title",S.textContent=`组建团队（${R.length} 个节点，自上而下即优先级）`;const L=document.createElement("input");L.className="p-dialog-input",L.maxLength=40,L.setAttribute("aria-label","团队名");const T=document.createElement("div");T.className="p-dialog-err",T.setAttribute("aria-live","polite");const C=document.createElement("div");C.className="p-dialog-row";const k=document.createElement("button");k.type="button",k.textContent="组建";const q=document.createElement("button");q.type="button",q.textContent="取消",C.append(k,q),f.append(S,L,T,C),U.appendChild(f),h.appendChild(U);const $=document.activeElement,ee=()=>{U.remove(),pe=null,$==null||$.focus()},le=()=>{const oe=L.value.trim();return oe===""||oe.length>40||oe.includes("/")||/^\d+$/.test(oe)?"队名需 1..40 字，不含“/”，不为纯数字":null},he=()=>{const oe=le();if(oe!==null){T.textContent=oe,L.focus();return}const ae=L.value.trim();if(ee(),e.getFrame(ae)!==void 0){j("info",`已加入现有团队「${ae}」`),J({type:"add-member",team:ae,ids:R});return}J({type:"create-team",name:ae,ids:R,created:!0})};k.addEventListener("click",he),q.addEventListener("click",ee),L.addEventListener("keydown",oe=>{const ae=oe;ae.key==="Enter"&&(ae.preventDefault(),he()),ae.key==="Escape"&&(ae.preventDefault(),ee())}),U.addEventListener("keydown",oe=>{const ae=oe;if(ae.key==="Escape"){ae.preventDefault(),ae.stopPropagation(),ee();return}if(ae.key!=="Tab")return;ae.preventDefault();const Te=Array.from(f.querySelectorAll("input, button")),Ne=Te.indexOf(document.activeElement),st=ae.shiftKey?Te[(Ne-1+Te.length)%Te.length]:Te[(Ne+1)%Te.length];st==null||st.focus()},m),pe={wrap:U,restoreFocus:$},L.focus()}let se=null,xe="root",Ae=null,we=null,fe=[];function Oe(){we==null||we.remove(),we=null}function Ie(){var f;if(we!==null){Oe();return}if(fe.length===0)return;const R=document.createElement("div");R.className="p-menu p-netmenu",R.setAttribute("role","menu"),R.setAttribute("aria-label","未入网会话");for(const S of fe)R.appendChild(N(`${S.name!==void 0&&S.name!==""?S.name:S.label} — 入网`,!0,()=>{Oe(),J({type:"join-network",id:S.id})}));we=R,document.body.appendChild(R);const U=P.getBoundingClientRect();R.style.left=`${String(Math.min(U.left,window.innerWidth-220))}px`,R.style.top=`${String(Math.max(8,U.top-(fe.length*30+10)))}px`,R.addEventListener("keydown",S=>{S.key==="Escape"&&(S.stopPropagation(),Oe(),P.focus())}),(f=R.querySelector("button"))==null||f.focus()}function Ke(){se==null||se.remove(),se=null,xe="root",Ae!==null&&Ae.isConnected?Ae.focus():h.focus(),Ae=null}function N(R,U,f){const S=document.createElement("button");return S.type="button",S.setAttribute("role","menuitem"),S.textContent=R,U?S.addEventListener("click",()=>{Ke(),f()}):(S.disabled=!0,S.setAttribute("aria-disabled","true")),S}function ce(R,U,f,S="root"){var k,q,$,ee,le,he;Ae===null&&(Ae=f.kind==="node"?Me.get(f.id)??null:re.get(f.name)??null),se==null||se.remove(),xe=S;const L=document.createElement("div");L.className="p-menu",L.setAttribute("role","menu"),L.setAttribute("aria-label","团队操作");let T=[];if(f.kind==="frame")T=[N(`解散团队「${f.name}」`,!0,()=>J({type:"remove-team",name:f.name}))];else{const oe=f.id;if(S==="root"){const ae=N("组成团队…",e.selectedIds().length>=2,()=>qe(Ee()));ae.title="先框选或 Shift 加选至少 2 个节点",T.push(ae),hn.length>0&&(T.push(N("加入团队 ▸",!0,()=>ce(R,U,f,"join"))),(((k=e.getNode(oe))==null?void 0:k.memberships.map(Ne=>Ne.team))??[]).length>0&&(T.push(N("置顶路由 ▸",!0,()=>ce(R,U,f,"promote"))),T.push(N("离队 ▸",!0,()=>ce(R,U,f,"leave"))))),((q=e.getNode(oe))==null?void 0:q.remote)!==!0&&T.push(N("退网",!0,()=>J({type:"leave-network",id:oe})))}else{T.push(N("‹ 返回",!0,()=>ce(R,U,f,"root")));for(const ae of hn)if(S==="join"){const Te=(($=e.getNode(oe))==null?void 0:$.memberships.some(Ne=>Ne.team===ae.name))??!0;T.push(N(Te?`${ae.name}（已加入）`:ae.name,!Te,()=>J({type:"add-member",team:ae.name,ids:[oe]})))}else if(S==="leave"){const Te=((ee=e.getNode(oe))==null?void 0:ee.memberships.some(Ne=>Ne.team===ae.name))??!1;T.push(N(ae.name,Te,()=>J({type:"remove-member",team:ae.name,ids:[oe]})))}else{const Te=((le=e.getNode(oe))==null?void 0:le.memberships.some(Ne=>Ne.team===ae.name))??!1;T.push(N(ae.name,Te,()=>{const Ne=e.teamMemberIds(ae.name),st=[oe,...Ne.filter(je=>je!==oe)];J({type:"reorder",team:ae.name,ops:Kr(Ne,st)})}))}}}L.append(...T),L.style.left=`${Math.min(R,window.innerWidth-200)}px`;const C=T.length*30+8;L.style.top=`${Math.max(8,Math.min(U,window.innerHeight-C-8))}px`,L.addEventListener("keydown",oe=>{var st,je,be,at;const ae=oe,Te=Array.from(L.querySelectorAll("[role=menuitem]")),Ne=Te.indexOf(document.activeElement);ae.key==="ArrowDown"?(ae.preventDefault(),(st=Te[(Ne+1+Te.length)%Te.length])==null||st.focus()):ae.key==="ArrowUp"?(ae.preventDefault(),(je=Te[(Ne-1+Te.length)%Te.length])==null||je.focus()):ae.key==="Home"?(ae.preventDefault(),(be=Te[0])==null||be.focus()):ae.key==="End"?(ae.preventDefault(),(at=Te[Te.length-1])==null||at.focus()):ae.key==="Escape"&&(ae.preventDefault(),ae.stopPropagation(),xe!=="root"?ce(R,U,f,"root"):Ke())}),h.appendChild(L),se=L,(he=T[0])==null||he.focus()}function H(R,U,f){var C;if(pe!==null)return;const S=(f==null?void 0:f.closest(".p-node"))??null;if(S!==null&&((C=e.getNode(S.dataset.id??""))==null?void 0:C.remote)===!0)return;const L=S,T=(f==null?void 0:f.closest(".p-frame-head"))??null;if(L!==null){const k=L.dataset.id??"";e.isSelected(k)||e.setSelection([k]),Ae=L,ce(R,U,{kind:"node",id:k})}else T!==null&&(Ae=T,ce(R,U,{kind:"frame",name:T.dataset.frame??""}))}function Q(R){const U=h.getBoundingClientRect();return{x:R.clientX-U.left,y:R.clientY-U.top}}function me(R,U){var C;const f=Q(U),S=Un(n,f.x,f.y),L=Nl(new Map(e.allFrames()),S),T=R.ids.filter(k=>{var q;return((q=e.getNode(k))==null?void 0:q.remote)!==!0});if(L!==void 0){const k=T.filter(q=>{var $;return!(($=e.getNode(q))!=null&&$.memberships.some(ee=>ee.team===L))});if(k.length>0){J({type:"add-member",team:L,ids:k});return}if(R.ids.length===1&&((C=e.getNode(R.clicked))==null?void 0:C.remote)!==!0){const q=e.teamMemberIds(L),$=j_(e,L);$.join("\0")!==q.join("\0")&&J({type:"reorder",team:L,ops:Kr(q,$)})}return}for(const k of R.origins)J({type:"remove-member",team:k.team,ids:[...k.ids]})}function ge(R){var T;if(_e===0&&He(),pe!==null){R.preventDefault();return}const U=R.target;if(se!==null){if(U!==null&&U.closest(".p-menu")!==null)return;Ke(),R.preventDefault();return}const f=Q(R);if(R.button===2){u={x:f.x,y:f.y,target:R.target,moved:!1},R.preventDefault();try{h.setPointerCapture(R.pointerId??0)}catch{}return}if(U!==null&&(U.closest("button")!==null||U.closest(".p-lamp")!==null||U.closest(".p-status")!==null))return;const S=U!==null?U.closest(".p-node"):null,L=U!==null?U.closest(".p-frame-head"):null;if((S!==null||L!==null)&&R.button===1){s={kind:"pan",last:f,moved:!1},R.preventDefault();try{h.setPointerCapture(R.pointerId??0)}catch{}return}if(S!==null){if(R.button!==0)return;const C=S.dataset.id??"",k=e.isSelected(C);!k&&!R.shiftKey&&e.setSelection([C]);const q=R.shiftKey||k?e.isSelected(C)?e.selectedIds():[...e.selectedIds(),C]:[C],$=new Map;for(const ee of q)for(const le of((T=e.getNode(ee))==null?void 0:T.memberships)??[])$.set(le.team,[...$.get(le.team)??[],ee]);s={kind:"node",clicked:C,ids:q,last:Un(n,f.x,f.y),moved:!1,el:S,origins:[...$].map(([ee,le])=>({team:ee,ids:le}))},S.classList.add("dragging")}else if(L!==null){if(R.button!==0)return;const C=L.dataset.frame??"",k=e.beginFrameDrag(C);if(k===void 0)return;s={kind:"frame",name:C,snap:k,origin:Un(n,f.x,f.y),moved:!1}}else if(R.button===1||R.button===0&&r)s={kind:"pan",last:f,moved:!1};else if(R.button===0)s={kind:"marquee",origin:f,last:f,additive:R.shiftKey},y.style.display="block",y.style.left=`${f.x}px`,y.style.top=`${f.y}px`,y.style.width="0px",y.style.height="0px";else return;R.preventDefault();try{h.setPointerCapture(R.pointerId??0)}catch{}}function Ge(R){const U=Q(R);if(u!==null){const f=U.x-u.x,S=U.y-u.y;Math.hypot(f,S)>4&&(u.moved=!0,n=qr(jr(n,-f,-S)),u.x=U.x,u.y=U.y,Be());return}if(s.kind==="node"){const f=Un(n,U.x,U.y),S=f.x-s.last.x,L=f.y-s.last.y;if(S===0&&L===0)return;s.moved=!0,s.last=f,e.dragNodes(s.ids,S,L);const T=Nl(new Map(e.allFrames()),f),C=s.ids.filter(q=>{var $;return(($=e.getNode(q))==null?void 0:$.remote)!==!0}),k=T!==void 0&&C.length>0;for(const[q,$]of re)$.classList.toggle("drop-target",k&&q===T);Y()}else if(s.kind==="frame"){const f=Un(n,U.x,U.y),S=f.x-s.origin.x,L=f.y-s.origin.y;if(!s.moved&&S===0&&L===0)return;s.moved=!0,e.applyFrameDrag(s.snap,S,L),Y()}else if(s.kind==="pan")n=jr(n,U.x-s.last.x,U.y-s.last.y),s.last=U,s.moved=!0,Be();else if(s.kind==="marquee"){const f=Math.min(s.origin.x,U.x),S=Math.min(s.origin.y,U.y);y.style.left=`${f}px`,y.style.top=`${S}px`,y.style.width=`${Math.abs(U.x-s.origin.x)}px`,y.style.height=`${Math.abs(U.y-s.origin.y)}px`,s.last=U}}function it(R){var U;if(u!==null){const f=u.moved,S=u.target,L=u.x,T=u.y;u=null,f?(_=!0,i.onDirty()):S!==null&&H(L,T,S);return}if(s.kind==="node"){const f=s.clicked;if(s.moved)me(s,R),i.onDirty();else if(R.shiftKey){const S=e.selectedIds();e.setSelection(S.includes(f)?S.filter(L=>L!==f):[...S,f])}else e.setSelection([f]);for(const S of re.values())S.classList.remove("drop-target");(U=s.el)==null||U.classList.remove("dragging"),Y()}else if(s.kind==="frame")s.moved&&i.onDirty();else if(s.kind==="pan")s.moved&&i.onDirty();else if(s.kind==="marquee"){const f=s.last,S=Un(n,Math.min(s.origin.x,f.x),Math.min(s.origin.y,f.y)),L=Un(n,Math.max(s.origin.x,f.x),Math.max(s.origin.y,f.y));e.marqueeSelect({x:S.x,y:S.y,w:L.x-S.x,h:L.y-S.y},s.additive),y.style.display="none",Y()}s={kind:"none"};try{h.releasePointerCapture(R.pointerId??0)}catch{}}function pt(R){se!==null&&Ke();const U=Q(R);if(R.ctrlKey){const f=R.deltaMode===1?16:1,S=Math.exp(-((R.deltaY??0)*f)*.0015);n=Dl(n,S,U.x,U.y)}else{const f=R.deltaMode===1?16:1;n=qr(jr(n,(R.deltaX??0)*f,(R.deltaY??0)*f))}R.preventDefault(),Be(),i.onDirty()}function Ve(R){He(),n=Dl(n,R,_e/2,ve/2),Be(),i.onDirty()}function mt(){He(),n=Il(e.contentBounds(),_e,ve),Be(),i.onDirty()}function Lt(R){var T,C,k,q,$;if(pe!==null||R.ctrlKey||R.metaKey)return;if(se!==null){R.key==="Escape"&&(Ke(),R.preventDefault());return}if(R.key===" "&&R.target===h){r=!0,R.preventDefault();return}const U=((C=(T=R.target)==null?void 0:T.closest)==null?void 0:C.call(T,".p-frame-head"))??null;if((R.key==="Enter"||R.key===" ")&&U!==null){R.preventDefault();const ee=U.getBoundingClientRect();H(ee.left+ee.width/2,ee.top+ee.height/2,U);return}if(R.key===" "&&((q=(k=R.target)==null?void 0:k.classList)!=null&&q.contains("p-node"))){const le=R.target.dataset.id??"",he=e.selectedIds();e.setSelection(he.includes(le)?he.filter(oe=>oe!==le):[...he,le]),Y(),R.preventDefault();return}if(R.key==="F10"&&R.shiftKey||R.key==="ContextMenu"){R.preventDefault();const ee=document.activeElement??null,le=(($=ee==null?void 0:ee.getBoundingClientRect)==null?void 0:$.call(ee))??{left:0,top:0,width:0,height:0};H(le.left+le.width/2,le.top+le.height/2,ee);return}if(R.key==="Delete"||R.key==="Backspace"){R.preventDefault(),$i();return}if(R.altKey&&(R.key==="ArrowUp"||R.key==="ArrowDown")){R.preventDefault(),Zi(R.key==="ArrowUp");return}if(R.key==="g"||R.key==="G"){ue();return}if(R.key==="0"){mt();return}if(R.key==="="||R.key==="+"){Ve(1.2);return}if(R.key==="-"){Ve(1/1.2);return}if(R.key==="Escape"){if(se!==null){Ke(),Y();return}e.setSelection([]),Y();return}const f=R.shiftKey?40:8,L={ArrowLeft:[-f,0],ArrowRight:[f,0],ArrowUp:[0,-f],ArrowDown:[0,f]}[R.key];if(L!==void 0){R.preventDefault();const ee=e.selectedIds();ee.length>0&&(e.nudge(ee,L[0],L[1]),Y(),i.onDirty())}}function $i(){var S,L,T;const R=document.activeElement,U=((S=R==null?void 0:R.closest)==null?void 0:S.call(R,".p-frame-head"))??null,f=((L=R==null?void 0:R.closest)==null?void 0:L.call(R,".p-node"))??null;if(U!==null){J({type:"remove-team",name:U.dataset.frame??""});return}if(f!==null){const C=f.dataset.id??"",k=((T=e.getNode(C))==null?void 0:T.memberships.map(q=>q.team))??[];if(k.length===0){j("info","该节点未加入任何团队");return}if(k.length===1){J({type:"remove-member",team:k[0],ids:[C]});return}Ae=f,ce(window.innerWidth/2,window.innerHeight/2,{kind:"node",id:C},"leave");return}j("info","焦点不在节点或团队框上")}function Zi(R){var ee,le;const U=document.activeElement,f=((ee=U==null?void 0:U.closest)==null?void 0:ee.call(U,".p-node"))??null;if(f===null)return;const S=f.dataset.id??"",L=((le=e.getNode(S))==null?void 0:le.memberships)??[];if(L.length!==1)return;const T=L[0].team,C=e.teamMemberIds(T),k=C.indexOf(S),q=R?Math.max(0,k-1):Math.min(C.length-1,k+1);if(q===k)return;const $=[...C];$.splice(k,1),$.splice(q,0,S),J({type:"reorder",team:T,ops:Kr(C,$)})}function Yt(R){R.key===" "&&(r=!1)}h.addEventListener("pointerdown",R=>ge(R),m),h.addEventListener("pointermove",R=>Ge(R),m),h.addEventListener("pointerup",R=>it(R),m),h.addEventListener("wheel",R=>pt(R),{...m,passive:!1}),h.addEventListener("keydown",R=>Lt(R),m),h.addEventListener("keyup",R=>Yt(R),m),h.addEventListener("contextmenu",R=>{const U=R;if(U.preventDefault(),U.preventDefault(),_){_=!1;return}H(U.clientX,U.clientY,U.target)},m);let hn=[];function Ji(R){hn=R.teams,R.peers,Ye=R.inFlight??[],fe=R.sessions.filter(T=>T.joined!==!0&&!T.id.startsWith("peer-")),P.textContent=`未入网${fe.length>0?`(${String(fe.length)})`:""}`,P.disabled=fe.length===0,P.setAttribute("aria-disabled",String(fe.length===0)),fe.length===0&&Oe();const U=new Map;for(const T of R.teams)for(let C=0;C<T.members.length;C++){const k=T.members[C].id,q=U.get(k)??[];q.push({team:T.name,index:C}),U.set(k,q)}const f=new Set,S=T=>{var $;const C=U.get(T)??[];if(x.size===0)return C;const k=C.filter(ee=>!x.has(ee.team)),q=((($=e.getNode(T))==null?void 0:$.memberships)??[]).filter(ee=>x.has(ee.team));return[...k,...q]};for(const T of R.sessions)if(T.joined===!0)if(f.add(T.id),e.getNode(T.id)!==void 0)e.upsertNode({id:T.id,x:e.getNode(T.id).x,y:e.getNode(T.id).y,label:T.label,team:T.team,name:T.name,live:T.live!==!1,memberships:S(T.id)});else{const C=t==null?void 0:t.nodes[T.id];let k,q;if(C!==void 0)k=C.x,q=C.y;else{const $=Qi(T.id);k=$.x,q=$.y}e.upsertNode({id:T.id,x:k,y:q,label:T.label,team:T.team,name:T.name,live:T.live!==!1,memberships:S(T.id)})}for(const T of e.nodeIds())!f.has(T)&&!T.startsWith("peer-")&&e.removeNode(T);const L=new Set;_t=F_(R.remoteTeams??[]),ke.clear();for(const T of R.peers??[])ke.set(ha(T.url),T.score);if(R.peers!==void 0){const T=e.contentBounds(),C=H_(R.peers,T);R.peers.forEach((k,q)=>{var oe,ae;const $=U_(k.url);L.add($);const ee=t==null?void 0:t.nodes[$],le=e.getNode($),he=le!==void 0?{x:le.x,y:le.y}:ee!==void 0?{x:ee.x,y:ee.y}:{x:((oe=C[q])==null?void 0:oe.x)??200,y:((ae=C[q])==null?void 0:ae.y)??0};e.upsertNode({id:$,x:he.x,y:he.y,label:k.url,team:"",name:k.url,peerUrl:k.url,live:!0,remote:!0,memberships:[]}),e.upsertScore($,k.score)})}for(const T of e.nodeIds())T.startsWith("peer-")&&!L.has(T)&&e.removeNode(T);for(const T of R.teams){if(e.getFrame(T.name)!==void 0||x.has(T.name))continue;const C=t==null?void 0:t.frames[T.name];if(C!==void 0){e.setFrame(T.name,{...C});continue}const k=[];for(const q of T.members){const $=e.getNode(q.id);$!==void 0&&k.push(xi($))}k.length>0&&e.setFrame(T.name,ca(k))}for(const[T]of e.allFrames())x.has(T)||R.teams.some(C=>C.name===T)||e.removeFrame(T);A(R),Y()}function Qi(R){return Ac(R)}function jn(R){const U=bc(R);U!==void 0&&(t=U,s.kind==="none"&&(n=qr({...U.viewport})),o=-1,Y())}function es(){return C_(n,e.positions(),e.frameRects())}function Kn(R,U){F.classList.remove("pending","saved","error"),R==="pending"&&F.classList.add("pending"),R==="saved"&&F.classList.add("saved"),R==="error"&&F.classList.add("error"),R==="error"?(F.tabIndex=0,F.setAttribute("role","button"),F.setAttribute("aria-label","布局保存失败，按回车重试")):(F.removeAttribute("tabindex"),F.removeAttribute("role"),F.removeAttribute("aria-label"));const f=R==="pending"?"布局待保存…":R==="saved"?`布局已保存 ${U??""}`.trimEnd():R==="error"?"保存失败 · 回车重试":"布局";v.textContent=f}function ts(){h.style.display="block",He(),Be(),h.focus()}function ns(){h.style.display="none"}function cr(){l.abort();for(const R of c)clearTimeout(R)}return{root:h,reconcile:Ji,activate:ts,deactivate:ns,adoptExternalLayout:jn,snapshotDoc:es,setLamp:Kn,notice:j,destroy:cr,seam:{pointerDown:ge,pointerMove:Ge,pointerUp:it,wheel:pt,key:Lt,keyUp:Yt,contextMenu(R){R.preventDefault(),H(R.clientX,R.clientY,R.target)}}}}function Z_(i){return new URLSearchParams(i).get("mode")==="plan"?"plan":"scene"}const J_=800;function Q_(i){let e,t=!1,n=!1,s=!1,r="idle";function o(u){u!==r&&(r=u,i.onLamp(u))}function a(){e!==void 0&&(e(),e=void 0)}function l(){a(),e=i.schedule(()=>{e=void 0,c(!1)},J_)}async function c(u){if(t){n=!0;return}t=!0,a();const _=i.snapshot();let m;try{m=JSON.stringify(_)}catch{t=!1,o("error"),i.onHttpError("layout document is not JSON-serializable");return}try{const h=await i.send(_,{keepalive:u});if(h===null||typeof h!="object"||h.ok!==!0){o("error");const g=h!==null&&typeof h=="object"&&typeof h.error=="string"?h.error:"layout save refused";i.onHttpError(`layout save: ${g}`)}else JSON.stringify(i.snapshot())===m&&(i.onAdopt(h.layout),o("saved"))}catch(h){o("error"),i.onHttpError(`layout save unreachable: ${String((h==null?void 0:h.message)??h).slice(0,80)}`)}if(t=!1,r==="error"){s=!1;return}if(s){s=!1,c(!0);return}n&&(n=!1,o("pending"),l())}return{markDirty(){if(n=!1,o("pending"),t){n=!0;return}l()},retry(){r!=="error"||t||(o("pending"),c(!1))},flush(){if(t){s=!0,n=!0;return}a(),c(!0)},isBusy(){return t},dispose(){a()}}}const eg=20;function tg(i,e,t=eg){const n=new Map;let s=0,r=0;for(const u of i){const _=e[u],m=_!==void 0&&Number.isFinite(_.x)&&Number.isFinite(_.y)?{x:_.x,y:_.y}:ng(u);n.set(u,m),s+=m.x,r+=m.y}const o=n.size;if(o===0)return n;s/=o,r/=o;let a=0;for(const u of n.values())a=Math.max(a,Math.hypot(u.x-s,u.y-r));const l=a>0?t/a:0,c=new Map;for(const[u,_]of n)c.set(u,{x:(_.x-s)*l,y:(_.y-r)*l});return c}function ng(i){const e=L_(i);return{x:e.x,y:e.z}}function Ul(i){return typeof i.error=="string"?i.error:void 0}function ig(i){const e=new Map;let t=0;function n(o,a){t+=1;const l=e.get(o)??Promise.resolve(),c=async()=>{try{return await a()}finally{t-=1}},u=l.then(c,c);return e.set(o,u.then(()=>{},()=>{})),u}async function s(o){let a;try{a=await i.send(o)}catch(c){const u=String((c==null?void 0:c.message)??c).slice(0,80);return i.onNotice("error",`画布不可达：${u}`),!1}if(a.status>=400)return i.onNotice("error",Ul(a.body)??`HTTP ${a.status}`),!1;if(a.body.ok===!0)return!0;const l=Ul(a.body);return l!==void 0?(i.onNotice("error",l),!1):!0}async function r(o,a){for(const l of a)if(!await s({...o,id:l}))return!1;return!0}return{createTeam(o,a,l=!1){return n(o,async()=>{if(!await s({action:"create",name:o}))return!1;for(let c=0;c<a.length;c++)if(!await s({action:"add-member",name:o,id:a[c]}))return l&&c===0&&await s({action:"remove",name:o}),!1;return!0})},addMembers(o,a){return n(o,()=>r({action:"add-member",name:o},a))},removeMembers(o,a){return n(o,()=>r({action:"remove-member",name:o},a))},runRosterOps(o,a){return n(o,async()=>{for(const l of a){const c=l.op==="remove"?{action:"remove-member",name:o,id:l.id}:{action:"add-member",name:o,id:l.id};if(!await s(c))return!1}return!0})},removeTeam(o){return n(o,()=>s({action:"remove",name:o}))},hasPending(){return t>0}}}const Ct=document.getElementById("app"),Ot=new Bm({antialias:!0});Ot.setSize(Ct.clientWidth||window.innerWidth,Ct.clientHeight||window.innerHeight);Ot.setPixelRatio(Math.min(window.devicePixelRatio,2));Ct.appendChild(Ot.domElement);const Gi=document.createElement("div");Gi.className="nexus-fault";Ct.appendChild(Gi);const{fault:Bs,clear:sg}=u_({show(i){Gi.textContent=i,Gi.style.display="block"},hide(){Gi.style.display="none"}},i=>console.error(i)),un=new c_;un.setSize(Ct.clientWidth||window.innerWidth,Ct.clientHeight||window.innerHeight);un.domElement.style.position="absolute";un.domElement.style.top="0";un.domElement.style.pointerEvents="none";Ct.appendChild(un.domElement);const Xt=new zm;Xt.background=new We(h_.bg0);Xt.fog=new ia(395794,.005);const Wn=new Nt(60,Ct.clientWidth/Ct.clientHeight,.1,500);Wn.position.set(0,35,55);const rg=xc();let zs;const Ri=new Km(Wn,Ot.domElement);Ri.enableDamping=!rg;Ri.dampingFactor=.06;Ri.minDistance=8;Ri.maxDistance=180;Xt.add(new Wm(3359846,1.6));const Rc=new gc(16777215,1.7);Rc.position.set(25,50,25);Xt.add(Rc);const Cc=new gc(9133302,.35);Cc.position.set(-25,-10,-20);Xt.add(Cc);const Pc=new Ym(120,60,1845056,1120814);Pc.position.y=-16;Xt.add(Pc);const qs=new yn,zi=new yn,ki=new yn,Hi=new yn;Xt.add(zi,qs,ki,Hi);new qn({color:2282478,transparent:!0,opacity:.6});const og=new qn({color:16096779,transparent:!0,opacity:.65});function ag(i,e){const t=new sa(e,1),n=new mc({color:i,emissive:i,emissiveIntensity:.7,roughness:.3});return new Ft(t,n)}async function lg(){try{const i=await fetch("/__dsh_a2a/canvas-layout",{cache:"no-store"});return i.ok?(await i.json()).layout??null:null}catch{return null}}const Kt=new Map,$r=new Map,js=new Map,Ks=new Map;async function fa(){var m;let i;try{i=await fetch("/__dsh_a2a/state",{cache:"no-store"})}catch(h){Bs(`state unreachable: ${String((h==null?void 0:h.message)??h).slice(0,80)}`);return}if(!i.ok){Bs(`state ${i.status} from host`);return}sg();let e;try{e=await i.json()}catch(h){Bs(`state JSON parse failed: ${String((h==null?void 0:h.message)??h).slice(0,80)}`);return}const t=(e.sessions??[]).filter(h=>h.joined===!0),n=((m=e.canvas)==null?void 0:m.teams)??[],s=(e.peers??[]).filter(h=>h!==null&&typeof h=="object"&&typeof h.url=="string"),r=(e.inFlight??[]).filter(h=>h!==null&&typeof h=="object"&&typeof h.team=="string"&&typeof h.peer=="string"&&Number.isFinite(h.startedAt)),o=await lg(),a=new Set(t.map(h=>h.id));for(const[h,g]of[...Kt])if(!a.has(h)){const M=$r.get(h);M&&E_(M),ws([g]),g.material instanceof Yn&&g.material.dispose(),qs.remove(g),Kt.delete(h),js.delete(h),Ks.delete(h)}for(let h=0;h<t.length;h++){const g=t[h],M=g.id,p=g.live!==!1;let d=Kt.get(M);if(!d){const b=p?bl.nodeLive:bl.nodeCold;d=ag(b,p?.9:.5),d.userData={label:Vo(g),sid:M},qs.add(d),Kt.set(M,d)}$r.has(M)||$r.set(M,y_(d,Vo(g),p,g.team)),Ks.set(M,g.team),js.set(M,g)}const l=tg(t.map(h=>h.id),(o==null?void 0:o.nodes)??{});for(const[h,g]of Kt){const M=l.get(h);M!==void 0&&g.position.set(M.x,0,M.y)}ws(Hi.children),ws(zi.children),zi.clear(),ws(ki.children),ki.clear(),x_(n,Kt,Hi,zi),M_(s,ki,Hi);const c=r;for(const h of c){const g=zi.children.find(d=>{var b;return((b=d.userData)==null?void 0:b.team)===h.team}),M=ki.children.find(d=>{var b;return((b=d.userData)==null?void 0:b.peer)===h.peer});if(g===void 0||M===void 0)continue;const p=new Pt().setFromPoints([g.position.clone(),M.position.clone()]);Hi.add(new sr(p,og))}T_(Ot.domElement,t,n,s),zs==null||zs.renderOnce();const u=JSON.stringify(o??null);u!==Fl&&(Fl=u,(Wo==="idle"||Wo==="saved")&&!$s.isBusy()&&ln.adoptExternalLayout(o));const _=(e.remote??[]).filter(h=>h!==null&&typeof h=="object"&&typeof h.team=="string"&&typeof h.via=="string").map(h=>({team:h.team,name:h.name,via:h.via,workspace:h.workspace}));ln.reconcile({sessions:t,teams:n,peerCount:s.length,peers:s,inFlight:r,remoteTeams:_}),Zr=e.canvas!==void 0,Ki.style.display=Zr?"":"none",!Zr&&ar==="plan"&&lr("scene")}let ar="scene",Zr=!1,Wo="idle",Fl;const Oi=ig({send:async i=>{const e=await fetch("/__dsh_a2a/canvas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(i),cache:"no-store"});return{status:e.status,body:await e.json()}},onNotice:(i,e)=>ln.notice(i,e)});function cg(i){switch(i.type){case"create-team":return Oi.createTeam(i.name,i.ids,i.created);case"add-member":return Oi.addMembers(i.team,i.ids);case"remove-member":return Oi.removeMembers(i.team,i.ids);case"remove-team":return Oi.removeTeam(i.name);case"reorder":return Oi.runRosterOps(i.team,i.ops);case"join-network":case"leave-network":return ug(i.type==="join-network"?"join":"leave",i.id)}}async function ug(i,e){const t=await fetch(`/__dsh_a2a/${i}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e}),cache:"no-store"}).catch(()=>{});return t!==void 0&&t.ok}const ln=$_({onDirty:()=>$s.markDirty(),onLampClick:()=>$s.retry(),onCanvasAction:async i=>{const e=await cg(i);return fa(),e}});Ct.appendChild(ln.root);const $s=Q_({snapshot:()=>ln.snapshotDoc(),send:(i,e)=>fetch("/__dsh_a2a/canvas-layout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",layout:i}),cache:"no-store",keepalive:e.keepalive}).then(async t=>await t.json()),schedule:(i,e)=>{const t=setTimeout(i,e);return()=>{clearTimeout(t)}},now:Date.now,onLamp:i=>{Wo=i;const e=new Date,t=String(e.getHours()).padStart(2,"0")+":"+String(e.getMinutes()).padStart(2,"0");ln.setLamp(i,t)},onAdopt:i=>{ln.adoptExternalLayout(i)},onHttpError:i=>Bs(i)});window.addEventListener("pagehide",()=>$s.flush());const ji=document.createElement("div");ji.className="nexus-modes";ji.setAttribute("role","tablist");ji.setAttribute("aria-label","舞台模式");const Lc=(i,e)=>{const t=document.createElement("button");return t.type="button",t.textContent=i,t.title=e,t.setAttribute("role","tab"),t},Zs=Lc("观测","3D 拓扑观测模式"),Ki=Lc("规划","2D 无限画布 · 规划模式");Ki.style.display="none";ji.append(Zs,Ki);Ct.appendChild(ji);function lr(i){ar=i,Zs.setAttribute("aria-selected",String(i==="scene")),Ki.setAttribute("aria-selected",String(i==="plan")),Ot.domElement.tabIndex=i==="scene"?0:-1,i==="plan"?(Mi=void 0,oa(),un.domElement.style.display="none",ln.activate()):(un.domElement.style.display="",ln.deactivate(),Zs.focus())}Zs.addEventListener("click",()=>lr("scene"));Ki.addEventListener("click",()=>lr("plan"));setInterval(()=>void fa(),5e3);fa();const Ol=new Xm,Jr=new Le;let Mi;lr(Z_(window.location.search));Ot.domElement.addEventListener("pointerdown",i=>{const e=Ot.domElement.getBoundingClientRect();Jr.x=(i.clientX-e.left)/e.width*2-1,Jr.y=-((i.clientY-e.top)/e.height)*2+1,Ol.setFromCamera(Jr,Wn);const t=Ol.intersectObjects(qs.children,!1)[0];if(t){const n=t.object.userData;Mi=n.sid;const s=n.sid!==void 0?js.get(n.sid):void 0,r=s?s.live!==!1?"live":"cold":"?";Mc(Ct,(n.label??"")+" · "+r+" · 团队 "+((s==null?void 0:s.team)??Ks.get(n.sid??"")??"?"))}else Mi=void 0,oa()});Ot.domElement.addEventListener("keydown",A_({pinned:()=>Mi,ids:()=>[...Kt.keys()],nextAfter:i=>{const e=i!==void 0?[...Kt.keys()].indexOf(i):-1;return[...Kt.keys()][(e+1)%[...Kt.keys()].length]},pin:i=>{const e=js.get(i),t=Ks.get(i)??"?",n=e?e.live!==!1?"live":"cold":"?";Mi=i,Mc(Ct,i+" · "+n+" · 团队 "+t)},escape:()=>{Mi=void 0,oa()}},Ot.domElement));function hg(){ar==="scene"&&(un.render(Xt,Wn),Ot.render(Xt,Wn))}if(xc())zs=w_(Ri,hg);else{let i=function(){requestAnimationFrame(i),ar==="scene"&&(Ri.update(),un.render(Xt,Wn),Ot.render(Xt,Wn))};i()}
