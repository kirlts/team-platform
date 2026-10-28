#!/usr/bin/env python3
"""Contraste WCAG de los pares de texto de los bocetos. Mezcla en sRGB codificado, como el navegador.  python3 contraste.py"""
import math
def lin2g(x): return 12.92*x if x<=0.0031308 else 1.055*x**(1/2.4)-0.055
def g2lin(x): return x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4
def oklch(L,C,h):
    hr=math.radians(h);a=C*math.cos(hr);b=C*math.sin(hr)
    l=(L+0.3963377774*a+0.2158037573*b)**3;m=(L-0.1055613458*a-0.0638541728*b)**3;s=(L-0.0894841775*a-1.2914855480*b)**3
    return [lin2g(max(0,min(1,x))) for x in (4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s)]
def lum(g): r,gg,b=[g2lin(x) for x in g]; return 0.2126*r+0.7152*gg+0.0722*b
def cr(a,b):
    la,lb=lum(a),lum(b)
    if la<lb: la,lb=lb,la
    return (la+0.05)/(lb+0.05)
def over(c,a,w=(1,1,1)): return [x*(1-a)+y*a for x,y in zip(c,w)]
def mix(p,q,t): return oklch(p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t)
W=(1,1,1); O=oklch
def barra(ink,c1,c2,ov,mitad=0.25):
    """Texto sobre una barra con brillo (ov) en la mitad superior: peor caso entre el borde de arriba y el centro del texto."""
    return min(cr(ink,over(mix(c1,c2,t),ov)) for t in (0,mitad,0.5))
rows=[
 ('A claro, título de ventana, blanco sobre degradado .44→.30 con brillo .22', barra(W,(.44,.15,250),(.30,.15,255),.22)),
 ('A oscuro, título de ventana, .97 sobre degradado .40→.26 con brillo .18', barra(O(.97,.01,245),(.40,.13,250),(.26,.10,255),.18)),
 ('A claro, fila activa, blanco sobre gel .44→.34 con brillo .18', barra(W,(.44,.2,250),(.34,.18,256),.18)),
 ('A oscuro, fila activa, tinta .16 sobre gel .80→.66 con brillo .18', barra(O(.16,.04,260),(.8,.14,235),(.66,.18,245),.18)),
 ('A, cifra LCD verde, ámbar, azul y rojo sobre LCD .24 (la peor)', min(cr(O(.88,.17,150),O(.24,.045,255)),cr(O(.86,.15,85),O(.24,.045,255)),cr(O(.8,.12,235),O(.24,.045,255)),cr(O(.8,.19,28),O(.24,.045,255)))),
 ('A, rótulo LCD .72 sobre LCD .24 y .14 (el peor)', min(cr(O(.72,.05,250),O(.24,.045,255)),cr(O(.72,.05,250),O(.14,.03,255)))),
 ('A, texto sobre panel claro', cr(O(.25,.05,265),O(.985,.006,240))),
 ('A, texto sobre panel oscuro', cr(O(.95,.015,245),O(.23,.04,257))),
 ('B claro, título de tabla blanco sobre .46 .10 235', cr(W,O(.46,.1,235))),
 ('B oscuro, título de tabla blanco sobre .38 .09 240', cr(W,O(.38,.09,240))),
 ('B claro, texto de categoría .36 sobre .86', cr(O(.36,.1,245),O(.86,.014,235))),
 ('B claro, texto sobre fila .925', cr(O(.24,.03,250),O(.925,.01,240))),
 ('B oscuro, texto sobre fila .205', cr(O(.93,.01,245),O(.205,.02,255))),
 ('B, barra superior, blanco sobre degradado .50→.34', min(cr(W,O(.5,.11,240)),cr(W,O(.34,.1,245)))),
 ('C claro, título de ventana oscuro .22 sobre celeste con brillo .6', barra(O(.22,.08,255),(.84,.08,215),(.72,.12,235),.6)),
 ('C oscuro, título de ventana blanco sobre .42→.30 con brillo .16', barra(W,(.42,.1,235),(.30,.09,255),.16)),
 ('C claro, fila activa, tinta .20 sobre aqua→azul .75→.55 con brillo .35', barra(O(.2,.08,255),(.75,.12,215),(.55,.17,245),.35)),
 ('C oscuro, fila activa, blanco sobre .40→.28 con brillo .12', barra(W,(.40,.12,235),(.28,.10,255),.12)),
 ('C claro, texto sobre cristal 62% sobre cielo aqua', cr(O(.25,.05,265),over(O(.9,.08,205),.62))),
 ('Botón primario claro, blanco sobre gel .46→.36 con brillo .16', barra(W,(.46,.2,248),(.36,.18,256),.16,.3)),
 ('Botón primario oscuro, tinta .18 sobre gel .80→.66 con brillo .22', barra(O(.18,.04,260),(.8,.14,235),(.66,.18,245),.22,.3)),
]
for k,v in rows: print(f'{v:5.2f}  {"cumple" if v>=4.5 else "NO CUMPLE"}  {k}')
