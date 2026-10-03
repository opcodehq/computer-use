#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/Xatom.h>
#include <X11/keysym.h>
#include <X11/extensions/XTest.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/select.h>
#include <time.h>
#include <signal.h>
#include <sys/prctl.h>
static Display *d;
static volatile sig_atomic_t cancelled;
static unsigned char heldKeys[256],heldButtons[8];
static void cancelInput(int sig) { (void)sig; cancelled=1; }
static void releaseInput(void) { if(!d)return;for(int k=0;k<256;k++)if(heldKeys[k])XTestFakeKeyEvent(d,k,False,CurrentTime);for(int b=1;b<8;b++)if(heldButtons[b])XTestFakeButtonEvent(d,b,False,CurrentTime);XSync(d,False); }

static int fail(Display *display, XErrorEvent *e) { fprintf(stderr,"X11 operation failed (%d)\n",e->error_code); exit(2); }
static void quote(const char *s) { putchar('"');for(;s&&*s;s++){unsigned char c=*s;if(c=='"'||c=='\\')putchar('\\');if(c>=32)putchar(c);}putchar('"'); }
static unsigned long prop(Window w,const char *name) {Atom t;int f;unsigned long n,left;unsigned char *v=NULL;unsigned long result=0;if(XGetWindowProperty(d,w,XInternAtom(d,name,False),0,1,False,AnyPropertyType,&t,&f,&n,&left,&v)==Success&&v&&n&&f==32)result=*(unsigned long*)v;if(v)XFree(v);return result;}
static int first=1;
static void list(Window w,int depth) {if(depth>3)return;Window root,parent,*children=NULL;unsigned n=0;XWindowAttributes a;if(!XGetWindowAttributes(d,w,&a))return;unsigned long pid=prop(w,"_NET_WM_PID");if(pid&&a.map_state==IsViewable&&a.width>20&&a.height>20){char *name=NULL;XFetchName(d,w,&name);Window child;int x,y;XTranslateCoordinates(d,w,DefaultRootWindow(d),0,0,&x,&y,&child);if(!first)putchar(',');first=0;printf("{\"id\":%lu,\"pid\":%lu,\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"title\":",w,pid,x,y,a.width,a.height);quote(name?name:"");puts("}");if(name)XFree(name);return;}if(XQueryTree(d,w,&root,&parent,&children,&n)){for(unsigned i=0;i<n;i++)list(children[i],depth+1);if(children)XFree(children);}}
static void key(KeySym sym,int down) {KeyCode code=XKeysymToKeycode(d,sym);if(!code){fprintf(stderr,"Unsupported keysym\n");exit(2);}XTestFakeKeyEvent(d,code,down,CurrentTime);heldKeys[code]=down;}
static void stroke(const char *spec) {char copy[128];if(strlen(spec)>=sizeof(copy))exit(2);strcpy(copy,spec);KeySym modifiers[8];int n=0;char *save,*part=strtok_r(copy,"+",&save);while(part){char *next=strtok_r(NULL,"+",&save);KeySym sym=XStringToKeysym(part);if(sym==NoSymbol)exit(2);if(next){if(n==8)exit(2);modifiers[n++]=sym;key(sym,True);}else{key(sym,True);key(sym,False);}part=next;}while(n)key(modifiers[--n],False);XSync(d,False);}

static int background;
static void move(Window w, int x, int y, unsigned int state) {
  Window child; int rx,ry;
  XTranslateCoordinates(d,w,DefaultRootWindow(d),x,y,&rx,&ry,&child);
  if(!background){XTestFakeMotionEvent(d,-1,rx,ry,CurrentTime);return;}
  XEvent event={0}; event.xmotion.type=MotionNotify; event.xmotion.display=d;
  event.xmotion.window=w; event.xmotion.root=DefaultRootWindow(d);
  event.xmotion.x=x;event.xmotion.y=y;event.xmotion.x_root=rx;event.xmotion.y_root=ry;
  event.xmotion.state=state;event.xmotion.same_screen=True;
  XSendEvent(d,w,True,PointerMotionMask,&event);
}
static void button(Window w,int x,int y,int number,int down,unsigned int state) {
  if(!background){XTestFakeButtonEvent(d,number,down,CurrentTime);if(number<8)heldButtons[number]=down;return;}
  Window child;int rx,ry;XTranslateCoordinates(d,w,DefaultRootWindow(d),x,y,&rx,&ry,&child);
  XEvent event={0};event.xbutton.type=down?ButtonPress:ButtonRelease;event.xbutton.display=d;
  event.xbutton.window=w;event.xbutton.root=DefaultRootWindow(d);
  event.xbutton.x=x;event.xbutton.y=y;event.xbutton.x_root=rx;event.xbutton.y_root=ry;
  event.xbutton.button=number;event.xbutton.state=state;event.xbutton.same_screen=True;
  XSendEvent(d,w,True,down?ButtonPressMask:ButtonReleaseMask,&event);
}

int main(int argc,char **argv){if(argc<2)return 2;pid_t parent=getppid();if(prctl(PR_SET_PDEATHSIG,SIGTERM)==-1||getppid()!=parent)return 3;d=XOpenDisplay(NULL);if(!d){fprintf(stderr,"No X11 display\n");return 2;}XSetErrorHandler(fail);signal(SIGTERM,cancelInput);signal(SIGINT,cancelInput);atexit(releaseInput);background=getenv("CU_INPUT_DELIVERY") && !strcmp(getenv("CU_INPUT_DELIVERY"),"background");
 if(!strcmp(argv[1],"display")){XWindowAttributes a;XGetWindowAttributes(d,DefaultRootWindow(d),&a);printf("{\"id\":%lu,\"width\":%d,\"height\":%d,\"screen\":%d}\n",DefaultRootWindow(d),a.width,a.height,DefaultScreen(d));}
 else if(!strcmp(argv[1],"state")){Window focus,root,child;int revert,x,y,wx,wy;unsigned mask;XGetInputFocus(d,&focus,&revert);XQueryPointer(d,DefaultRootWindow(d),&root,&child,&x,&y,&wx,&wy,&mask);printf("{\"focus\":%lu,\"x\":%d,\"y\":%d,\"appClass\":",focus,x,y);XClassHint hint={0};Window probe=focus;for(int i=0;i<5&&probe>1;i++){if(XGetClassHint(d,probe,&hint))break;Window pr,pa,*ch=NULL;unsigned n;if(!XQueryTree(d,probe,&pr,&pa,&ch,&n))break;if(ch)XFree(ch);probe=pa;}quote(hint.res_class?hint.res_class:"");puts("}");if(hint.res_name)XFree(hint.res_name);if(hint.res_class)XFree(hint.res_class);}
 else if(!strcmp(argv[1],"list")){putchar('[');list(DefaultRootWindow(d),0);puts("]");}
 else if(argc>=3){Window w=!strcmp(argv[2],"root")?DefaultRootWindow(d):strtoul(argv[2],NULL,10);XWindowAttributes a;if(!XGetWindowAttributes(d,w,&a)||a.map_state!=IsViewable)return 2;
 if(!strcmp(argv[1],"capture")){if(a.width>8192||a.height>8192||(long)a.width*a.height>24000000)return 2;XImage *im=XGetImage(d,w,0,0,a.width,a.height,AllPlanes,ZPixmap);if(!im)return 2;printf("P6\n%d %d\n255\n",a.width,a.height);for(int y=0;y<a.height;y++)for(int x=0;x<a.width;x++){unsigned long p=XGetPixel(im,x,y);unsigned char rgb[3]={(p>>16)&255,(p>>8)&255,p&255};fwrite(rgb,1,3,stdout);}XDestroyImage(im);}
 else {if(!background && w!=DefaultRootWindow(d)){XRaiseWindow(d,w);XSetInputFocus(d,w,RevertToParent,CurrentTime);XSync(d,False);}
 if((!strcmp(argv[1],"click")||!strcmp(argv[1],"doubleClick")||!strcmp(argv[1],"rightClick")||!strcmp(argv[1],"hover")||!strcmp(argv[1],"drag"))&&argc>=5){
   int x=atoi(argv[3]),y=atoi(argv[4]),tx=x,ty=y;
   if(!strcmp(argv[1],"drag")){if(argc!=7)return 2;tx=atoi(argv[5]);ty=atoi(argv[6]);}
   if(x<0||y<0||x>=a.width||y>=a.height||tx<0||ty<0||tx>=a.width||ty>=a.height)return 2;
   move(w,x,y,0);XSync(d,False);
   if(strcmp(argv[1],"hover")){
     int number=!strcmp(argv[1],"rightClick")?3:1;
     int repeats=!strcmp(argv[1],"doubleClick")?2:1;
     for(int i=0;i<repeats&&!cancelled;i++){
       button(w,x,y,number,True,0);
       if(!strcmp(argv[1],"drag"))for(int step=1;step<=24&&!cancelled;step++){move(w,x+(tx-x)*step/24,y+(ty-y)*step/24,Button1Mask);XSync(d,False);usleep(12000);}
       button(w,tx,ty,number,False,number==1?Button1Mask:Button3Mask);XSync(d,False);
       if(repeats>1)usleep(70000);
     }
   }
 }
 else if(!strcmp(argv[1],"focus")){if(w==DefaultRootWindow(d))return 2;}
 else if((!strcmp(argv[1],"keyDown")||!strcmp(argv[1],"keyUp"))&&argc==4){KeySym sym=XStringToKeysym(argv[3]);KeyCode code=XKeysymToKeycode(d,sym);if(!code||background)return 2;XTestFakeKeyEvent(d,code,!strcmp(argv[1],"keyDown"),CurrentTime);}
 else if((!strcmp(argv[1],"buttonDown")||!strcmp(argv[1],"buttonUp"))&&argc==4){int b=atoi(argv[3]);if(b<1||b>3||background)return 2;XTestFakeButtonEvent(d,b,!strcmp(argv[1],"buttonDown"),CurrentTime);}
 else if(!strcmp(argv[1],"key")&&argc==4){if(background)return 2;stroke(argv[3]);}
 else if((!strcmp(argv[1],"scroll")||!strcmp(argv[1],"scrollX"))&&argc==4){if(background)return 2;int amount=atoi(argv[3]);if(amount < -30||amount>30)return 2;for(int i=0;i<abs(amount)&&!cancelled;i++){XTestFakeButtonEvent(d,!strcmp(argv[1],"scrollX")?(amount>0?7:6):(amount>0?5:4),True,CurrentTime);XTestFakeButtonEvent(d,!strcmp(argv[1],"scrollX")?(amount>0?7:6):(amount>0?5:4),False,CurrentTime);}}
 else if(!strcmp(argv[1],"type")&&(argc==4||argc==5)){
   if(background)return 2;
   Window owner=XCreateSimpleWindow(d,DefaultRootWindow(d),0,0,1,1,0,0,0);
   Atom clipboard=XInternAtom(d,"CLIPBOARD",False),utf8=XInternAtom(d,"UTF8_STRING",False),targets=XInternAtom(d,"TARGETS",False);
   XSetSelectionOwner(d,clipboard,owner,CurrentTime);if(argc==5&&!strcmp(argv[4],"Shift_L+Insert"))XSetSelectionOwner(d,XA_PRIMARY,owner,CurrentTime);XSync(d,False);
   if(XGetSelectionOwner(d,clipboard)!=owner)return 2;
   stroke(argc==5?argv[4]:"Control_L+v");
   int delivered=0;
   struct timespec started,now,last;clock_gettime(CLOCK_MONOTONIC,&started);last=started;
   for(;!cancelled;){
     while(XPending(d)){
       XEvent event;XNextEvent(d,&event);
       if(event.type!=SelectionRequest)continue;
       clock_gettime(CLOCK_MONOTONIC,&last);
       XSelectionRequestEvent *r=&event.xselectionrequest;
       XEvent reply={0};reply.xselection.type=SelectionNotify;reply.xselection.display=d;
       reply.xselection.requestor=r->requestor;reply.xselection.selection=r->selection;
       reply.xselection.target=r->target;reply.xselection.time=r->time;reply.xselection.property=None;
       Atom property=r->property==None?r->target:r->property;
       if(r->target==targets){Atom formats[]={targets,utf8,XA_STRING};XChangeProperty(d,r->requestor,property,XA_ATOM,32,PropModeReplace,(unsigned char*)formats,3);reply.xselection.property=property;}
       else if(r->target==utf8||r->target==XA_STRING){XChangeProperty(d,r->requestor,property,r->target,8,PropModeReplace,(unsigned char*)argv[3],strlen(argv[3]));reply.xselection.property=property;delivered=1;}
       XSendEvent(d,r->requestor,False,0,&reply);XFlush(d);
     }
     /* Serve every selection request until the clipboard consumer completes. */
     clock_gettime(CLOCK_MONOTONIC,&now);if(now.tv_sec-started.tv_sec>=3)break;
     if(delivered && (now.tv_sec-last.tv_sec)*1000000000L+now.tv_nsec-last.tv_nsec>300000000L)break;
     fd_set fds;FD_ZERO(&fds);FD_SET(ConnectionNumber(d),&fds);struct timeval timeout={0,100000};select(ConnectionNumber(d)+1,&fds,NULL,NULL,&timeout);
   }
   XDestroyWindow(d,owner);if(!delivered)return 2;
 }
 else { return 2; }
 XSync(d,False);}}
 else { return 2; }
 releaseInput();XCloseDisplay(d);d=NULL;return cancelled?3:0;}
