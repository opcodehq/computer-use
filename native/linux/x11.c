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
static Display *d;
static int fail(Display *display, XErrorEvent *e) { fprintf(stderr,"X11 operation failed (%d)\n",e->error_code); exit(2); }
static void quote(const char *s) { putchar('"');for(;s&&*s;s++){unsigned char c=*s;if(c=='"'||c=='\\')putchar('\\');if(c>=32)putchar(c);}putchar('"'); }
static unsigned long prop(Window w,const char *name) {Atom t;int f;unsigned long n,left;unsigned char *v=NULL;unsigned long result=0;if(XGetWindowProperty(d,w,XInternAtom(d,name,False),0,1,False,AnyPropertyType,&t,&f,&n,&left,&v)==Success&&v&&n&&f==32)result=*(unsigned long*)v;if(v)XFree(v);return result;}
static int first=1;
static void list(Window w,int depth) {if(depth>3)return;Window root,parent,*children=NULL;unsigned n=0;XWindowAttributes a;if(!XGetWindowAttributes(d,w,&a))return;unsigned long pid=prop(w,"_NET_WM_PID");if(pid&&a.map_state==IsViewable&&a.width>20&&a.height>20){char *name=NULL;XFetchName(d,w,&name);Window child;int x,y;XTranslateCoordinates(d,w,DefaultRootWindow(d),0,0,&x,&y,&child);if(!first)putchar(',');first=0;printf("{\"id\":%lu,\"pid\":%lu,\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"title\":",w,pid,x,y,a.width,a.height);quote(name?name:"");puts("}");if(name)XFree(name);return;}if(XQueryTree(d,w,&root,&parent,&children,&n)){for(unsigned i=0;i<n;i++)list(children[i],depth+1);if(children)XFree(children);}}
static void key(KeySym sym,int down) {KeyCode code=XKeysymToKeycode(d,sym);if(!code){fprintf(stderr,"Unsupported keysym\n");exit(2);}XTestFakeKeyEvent(d,code,down,CurrentTime);}
static void stroke(const char *spec) {char copy[128];if(strlen(spec)>=sizeof(copy))exit(2);strcpy(copy,spec);KeySym modifiers[8];int n=0;char *save,*part=strtok_r(copy,"+",&save);while(part){char *next=strtok_r(NULL,"+",&save);KeySym sym=XStringToKeysym(part);if(sym==NoSymbol)exit(2);if(next){if(n==8)exit(2);modifiers[n++]=sym;key(sym,True);}else{key(sym,True);key(sym,False);}part=next;}while(n)key(modifiers[--n],False);XSync(d,False);}
int main(int argc,char **argv){if(argc<2)return 2;d=XOpenDisplay(NULL);if(!d){fprintf(stderr,"No X11 display\n");return 2;}XSetErrorHandler(fail);
 if(!strcmp(argv[1],"list")){putchar('[');list(DefaultRootWindow(d),0);puts("]");}
 else if(argc>=3){Window w=strtoul(argv[2],NULL,10);XWindowAttributes a;if(!XGetWindowAttributes(d,w,&a)||a.map_state!=IsViewable)return 2;
 if(!strcmp(argv[1],"capture")){if(a.width>8192||a.height>8192)return 2;XImage *im=XGetImage(d,w,0,0,a.width,a.height,AllPlanes,ZPixmap);if(!im)return 2;printf("P6\n%d %d\n255\n",a.width,a.height);for(int y=0;y<a.height;y++)for(int x=0;x<a.width;x++){unsigned long p=XGetPixel(im,x,y);unsigned char rgb[3]={(p>>16)&255,(p>>8)&255,p&255};fwrite(rgb,1,3,stdout);}XDestroyImage(im);}
 else {XRaiseWindow(d,w);XSetInputFocus(d,w,RevertToParent,CurrentTime);XSync(d,False);
 if(!strcmp(argv[1],"click")&&argc==5){int x=atoi(argv[3]),y=atoi(argv[4]);if(x<0||y<0||x>=a.width||y>=a.height)return 2;Window c;int rx,ry;XTranslateCoordinates(d,w,DefaultRootWindow(d),x,y,&rx,&ry,&c);XTestFakeMotionEvent(d,-1,rx,ry,CurrentTime);XTestFakeButtonEvent(d,1,True,CurrentTime);XTestFakeButtonEvent(d,1,False,CurrentTime);}
 else if(!strcmp(argv[1],"key")&&argc==4)stroke(argv[3]);
 else if(!strcmp(argv[1],"scroll")&&argc==4){int amount=atoi(argv[3]);if(amount < -30||amount>30)return 2;for(int i=0;i<abs(amount);i++){XTestFakeButtonEvent(d,amount>0?5:4,True,CurrentTime);XTestFakeButtonEvent(d,amount>0?5:4,False,CurrentTime);}}
 else if(!strcmp(argv[1],"type")&&argc==4){
   Window owner=XCreateSimpleWindow(d,DefaultRootWindow(d),0,0,1,1,0,0,0);
   Atom clipboard=XInternAtom(d,"CLIPBOARD",False),utf8=XInternAtom(d,"UTF8_STRING",False),targets=XInternAtom(d,"TARGETS",False);
   XSetSelectionOwner(d,clipboard,owner,CurrentTime);XSync(d,False);
   if(XGetSelectionOwner(d,clipboard)!=owner)return 2;
   stroke("Control_L+v");
   int delivered=0;
   struct timespec started,now,last;clock_gettime(CLOCK_MONOTONIC,&started);last=started;
   for(;;){
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
 XCloseDisplay(d);return 0;}
