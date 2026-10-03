#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/keysym.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc,char**argv){
 Display*d=XOpenDisplay(NULL);if(!d)return 2;
 int x=argc>1?atoi(argv[1]):30;
 Window w=XCreateSimpleWindow(d,DefaultRootWindow(d),x,80,480,320,0,0,x>100?0xddeeff:0xffeedd);
 unsigned long pid=getpid();XChangeProperty(d,w,XInternAtom(d,"_NET_WM_PID",False),XA_CARDINAL,32,PropModeReplace,(unsigned char*)&pid,1);
 XStoreName(d,w,x>100?"Opcode Notes":"Opcode Terminal");
 XSelectInput(d,w,ExposureMask|ButtonPressMask|ButtonReleaseMask|PointerMotionMask|KeyPressMask|KeyReleaseMask|StructureNotifyMask);XMapWindow(d,w);
 GC gc=XCreateGC(d,w,0,NULL);XSetForeground(d,gc,0);char text[9000]="Synthetic desktop test";
 while(1){XEvent e;XNextEvent(d,&e);
  if(e.type==Expose){XDrawString(d,w,gc,24,42,text,strlen(text));XFlush(d);}
  if(e.type==ButtonPress||e.type==ButtonRelease){printf("button %d %d %d %d\n",e.type,e.xbutton.button,e.xbutton.x,e.xbutton.y);fflush(stdout);if(e.type==ButtonPress)XSetInputFocus(d,w,RevertToParent,CurrentTime);if(e.type==ButtonPress&&e.xbutton.button==3){Window menu=XCreateSimpleWindow(d,w,120,100,180,100,1,0,0xffffff);XMapRaised(d,menu);XFlush(d);}}
  if(e.type==KeyPress||e.type==KeyRelease){KeySym key=XLookupKeysym(&e.xkey,0);printf("key %d %lu\n",e.type,key);fflush(stdout);if(e.type==KeyPress&&(e.xkey.state&ControlMask)&&key==XK_v)XConvertSelection(d,XInternAtom(d,"CLIPBOARD",False),XInternAtom(d,"UTF8_STRING",False),XInternAtom(d,"PASTE",False),w,CurrentTime);}
  if(e.type==SelectionNotify&&e.xselection.property!=None){Atom type;int format;unsigned long n,left;unsigned char*bytes=NULL;XGetWindowProperty(d,w,e.xselection.property,0,2200,False,AnyPropertyType,&type,&format,&n,&left,&bytes);if(bytes){printf("text %.*s\n",(int)n,bytes);snprintf(text,sizeof(text),"%.*s",(int)n,bytes);XFree(bytes);XClearArea(d,w,0,0,0,0,True);fflush(stdout);}}
 }
}
