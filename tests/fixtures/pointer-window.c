#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <stdio.h>
#include <unistd.h>
int main(){
 Display*d=XOpenDisplay(NULL);if(!d)return 2;
 Window w=XCreateSimpleWindow(d,DefaultRootWindow(d),20,20,600,400,0,0,0xffffff);
 unsigned long pid=getpid();XChangeProperty(d,w,XInternAtom(d,"_NET_WM_PID",False),XA_CARDINAL,32,PropModeReplace,(unsigned char*)&pid,1);
 XStoreName(d,w,"CU pointer fixture");XSelectInput(d,w,ExposureMask|ButtonPressMask|ButtonReleaseMask|PointerMotionMask);XMapWindow(d,w);
 GC gc=XCreateGC(d,w,0,NULL);XSetForeground(d,gc,0);
 while(1){XEvent e;XNextEvent(d,&e);if(e.type==Expose){XDrawString(d,w,gc,30,40,"Pointer test area",17);XFlush(d);}else if(e.type==ButtonPress||e.type==ButtonRelease){printf("{\"type\":%d,\"button\":%u,\"x\":%d,\"y\":%d,\"synthetic\":%d}\n",e.type,e.xbutton.button,e.xbutton.x,e.xbutton.y,e.xbutton.send_event);fflush(stdout);}else if(e.type==MotionNotify){printf("{\"type\":6,\"x\":%d,\"y\":%d,\"synthetic\":%d}\n",e.xmotion.x,e.xmotion.y,e.xmotion.send_event);fflush(stdout);}}
}
