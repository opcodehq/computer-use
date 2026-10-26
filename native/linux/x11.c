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
#include <stdint.h>
#include <errno.h>
#include <arpa/inet.h>
static FILE *output;
#define printf(...) fprintf(output, __VA_ARGS__)
#define putchar(c) fputc(c,output)
#define puts(s) (fputs(s,output), fputc(10,output))
static int persistent;
static Window clipboardOwner;
static char *clipboardText;
static int clipboardDelivered;
static Display *d;
static volatile sig_atomic_t cancelled;
static unsigned char heldKeys[256],heldButtons[8];
static void cancelInput(int sig) { (void)sig; cancelled=1; }
static void releaseInput(void) { if(!d)return;for(int k=0;k<256;k++)if(heldKeys[k])XTestFakeKeyEvent(d,k,False,CurrentTime);for(int b=1;b<8;b++)if(heldButtons[b])XTestFakeButtonEvent(d,b,False,CurrentTime);XSync(d,False); }

static int fail(Display *display, XErrorEvent *e) { fprintf(stderr,"X11 operation failed (%d)\n",e->error_code); exit(2); }
static void quote(const char *s) { putchar('"');for(;s&&*s;s++){unsigned char c=*s;if(c=='"'||c=='\\')putchar('\\');if(c>=32)putchar(c);}putchar('"'); }
static unsigned long prop(Window w,const char *name) {Atom t;int f;unsigned long n,left;unsigned char *v=NULL;unsigned long result=0;if(XGetWindowProperty(d,w,XInternAtom(d,name,False),0,1,False,AnyPropertyType,&t,&f,&n,&left,&v)==Success&&v&&n&&f==32)result=*(unsigned long*)v;if(v)XFree(v);return result;}
static Window focusOwner(Window focus){Window probe=focus;for(int i=0;i<32&&probe>1;i++){if(prop(probe,"_NET_WM_PID"))return probe;Window root,parent,*children=NULL;unsigned count;if(!XQueryTree(d,probe,&root,&parent,&children,&count))break;if(children)XFree(children);if(parent==root)return probe;probe=parent;}return focus;}
static int first=1;
static void list(Window w,int depth) {if(depth>3)return;Window root,parent,*children=NULL;unsigned n=0;XWindowAttributes a;if(!XGetWindowAttributes(d,w,&a))return;unsigned long pid=prop(w,"_NET_WM_PID");if(pid&&a.map_state==IsViewable&&a.width>20&&a.height>20){char *name=NULL;Atom nameType;int nameFormat;unsigned long nameLength,nameLeft;unsigned char *utf8Name=NULL;
if(XGetWindowProperty(d,w,XInternAtom(d,"_NET_WM_NAME",False),0,1024,False,XInternAtom(d,"UTF8_STRING",False),&nameType,&nameFormat,&nameLength,&nameLeft,&utf8Name)==Success&&utf8Name&&nameFormat==8){name=strndup((char*)utf8Name,nameLength);XFree(utf8Name);}else{if(utf8Name)XFree(utf8Name);XFetchName(d,w,&name);}Window child;int x,y;XTranslateCoordinates(d,w,DefaultRootWindow(d),0,0,&x,&y,&child);if(!first)putchar(',');first=0;printf("{\"id\":%lu,\"pid\":%lu,\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"title\":",w,pid,x,y,a.width,a.height);quote(name?name:"");puts("}");if(name)XFree(name);return;}if(XQueryTree(d,w,&root,&parent,&children,&n)){for(unsigned i=0;i<n;i++)list(children[i],depth+1);if(children)XFree(children);}}
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

static long long nanos(void) { struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (long long)t.tv_sec*1000000000LL+t.tv_nsec; }
static unsigned char channel(unsigned long pixel,unsigned long mask) {
 if(!mask)return 0;
 while(!(mask&1)){mask>>=1;pixel>>=1;}return (unsigned char)(((pixel&mask)*255UL+mask/2)/mask);
}
/* Common 32-bit visuals avoid XGetPixel; uncommon layouts retain Xlib decoding. */
static void rgb(XImage *im,int x,int y,unsigned char *out) {
 if(im->format==ZPixmap&&(im->bits_per_pixel==32||im->bits_per_pixel==24)&&im->red_mask==0xff0000&&im->green_mask==0xff00&&im->blue_mask==0xff){
  const unsigned char *p=(const unsigned char*)im->data+y*im->bytes_per_line+x*(im->bits_per_pixel/8);
  if(im->byte_order==LSBFirst){out[0]=p[2];out[1]=p[1];out[2]=p[0];}else{int offset=im->bits_per_pixel==32?1:0;out[0]=p[offset];out[1]=p[offset+1];out[2]=p[offset+2];}return;
 }
 unsigned long pixel;
 if(im->format==ZPixmap && (im->bits_per_pixel==32||im->bits_per_pixel==24)) {
  const unsigned char *p=(const unsigned char*)im->data+y*im->bytes_per_line+x*(im->bits_per_pixel/8);pixel=0;
  if(im->byte_order==LSBFirst)for(int b=im->bits_per_pixel/8-1;b>=0;b--)pixel=(pixel<<8)|p[b];
  else for(int b=0;b<im->bits_per_pixel/8;b++)pixel=(pixel<<8)|p[b];
 } else pixel=XGetPixel(im,x,y);
 out[0]=channel(pixel,im->red_mask);out[1]=channel(pixel,im->green_mask);out[2]=channel(pixel,im->blue_mask);
}
static void pixels(XImage *im) {
 size_t size=(size_t)im->width*3;unsigned char *row=malloc(size);if(!row)exit(2);
 printf("P6\n%d %d\n255\n",im->width,im->height);
 for(int y=0;y<im->height;y++){for(int x=0;x<im->width;x++)rgb(im,x,y,row+x*3);if(fwrite(row,1,size,output)!=size)exit(2);}free(row);
}
static void clipboardEvents(void) {
 while(XPending(d)) {
  XEvent event;XNextEvent(d,&event);if(event.type!=SelectionRequest||!clipboardText)continue;
  XSelectionRequestEvent *r=&event.xselectionrequest;XEvent reply={0};reply.xselection.type=SelectionNotify;reply.xselection.display=d;
  reply.xselection.requestor=r->requestor;reply.xselection.selection=r->selection;reply.xselection.target=r->target;reply.xselection.time=r->time;
  Atom property=r->property==None?r->target:r->property,targets=XInternAtom(d,"TARGETS",False),utf8=XInternAtom(d,"UTF8_STRING",False);
  if(r->owner==clipboardOwner && r->target==targets){Atom formats[]={targets,utf8,XA_STRING};XChangeProperty(d,r->requestor,property,XA_ATOM,32,PropModeReplace,(unsigned char*)formats,3);reply.xselection.property=property;}
  else if(r->owner==clipboardOwner && (r->target==utf8||r->target==XA_STRING)){XChangeProperty(d,r->requestor,property,r->target,8,PropModeReplace,(unsigned char*)clipboardText,strlen(clipboardText));reply.xselection.property=property;clipboardDelivered=1;}
  XSendEvent(d,r->requestor,False,0,&reply);XFlush(d);
 }
}
static int frame(Window w,int sampleOnly) {
 long long started=nanos();XWindowAttributes a,root,after,rootAfter;Window child,focus;int revert,x,y;
 if(!XGetWindowAttributes(d,w,&a)||a.visual->class!=TrueColor||a.map_state!=IsViewable||!XGetWindowAttributes(d,DefaultRootWindow(d),&root)||a.width<1||a.height<1||a.width>8192||a.height>8192||(long)a.width*a.height>24000000)return 2;
 XTranslateCoordinates(d,w,DefaultRootWindow(d),0,0,&x,&y,&child);XGetInputFocus(d,&focus,&revert);
 XImage *im=XGetImage(d,w,0,0,a.width,a.height,AllPlanes,ZPixmap);if(!im)return 2;long long captured=nanos();
 Window focusAfter;XGetInputFocus(d,&focusAfter,&revert);
 int ax,ay;XTranslateCoordinates(d,w,DefaultRootWindow(d),0,0,&ax,&ay,&child);
 if(!XGetWindowAttributes(d,w,&after)||!XGetWindowAttributes(d,DefaultRootWindow(d),&rootAfter)||after.map_state!=IsViewable||after.width!=a.width||after.height!=a.height||ax!=x||ay!=y||root.width!=rootAfter.width||root.height!=rootAfter.height||focus!=focusAfter){XDestroyImage(im);return 2;}
 printf("{\"geometry\":{\"id\":%lu,\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d},\"displayGeometry\":{\"id\":%lu,\"x\":0,\"y\":0,\"width\":%d,\"height\":%d},\"focus\":%lu,\"captureMs\":%.3f}\n",w,x,y,a.width,a.height,DefaultRootWindow(d),root.width,root.height,focus,(captured-started)/1000000.0);
 if(sampleOnly){unsigned char sample[64*48*3];for(int sy=0;sy<48;sy++)for(int sx=0;sx<64;sx++)rgb(im,sx*a.width/64,sy*a.height/48,sample+(sy*64+sx)*3);fwrite(sample,1,sizeof(sample),output);}else pixels(im);
 XDestroyImage(im);return 0;
}
static int dispatch(int argc,char **argv){first=1;
 if(!strcmp(argv[1],"display")){XWindowAttributes a;XGetWindowAttributes(d,DefaultRootWindow(d),&a);printf("{\"id\":%lu,\"width\":%d,\"height\":%d,\"screen\":%d}\n",DefaultRootWindow(d),a.width,a.height,DefaultScreen(d));}
 else if(!strcmp(argv[1],"state")){Window focus,root,child;int revert,x,y,wx,wy;unsigned mask;XGetInputFocus(d,&focus,&revert);XQueryPointer(d,DefaultRootWindow(d),&root,&child,&x,&y,&wx,&wy,&mask);printf("{\"focus\":%lu,\"x\":%d,\"y\":%d,\"appClass\":",focus,x,y);XClassHint hint={0};Window probe=focus;for(int i=0;i<5&&probe>1;i++){if(XGetClassHint(d,probe,&hint))break;Window pr,pa,*ch=NULL;unsigned n;if(!XQueryTree(d,probe,&pr,&pa,&ch,&n))break;if(ch)XFree(ch);probe=pa;}quote(hint.res_class?hint.res_class:"");printf(",\"focusWindow\":%lu}\n",focusOwner(focus));if(hint.res_name)XFree(hint.res_name);if(hint.res_class)XFree(hint.res_class);}
 else if(!strcmp(argv[1],"list")){putchar('[');list(DefaultRootWindow(d),0);puts("]");}
 else if(argc>=3){Window w=!strcmp(argv[2],"root")?DefaultRootWindow(d):strtoul(argv[2],NULL,10);XWindowAttributes a;if(!XGetWindowAttributes(d,w,&a)||a.map_state!=IsViewable)return 2;
 if(!strcmp(argv[1],"frame")||!strcmp(argv[1],"sample"))return frame(w,!strcmp(argv[1],"sample"));
 else if(!strcmp(argv[1],"capture")){if(a.visual->class!=TrueColor)return 2;if(a.width>8192||a.height>8192||(long)a.width*a.height>24000000)return 2;XImage *im=XGetImage(d,w,0,0,a.width,a.height,AllPlanes,ZPixmap);if(!im)return 2;pixels(im);XDestroyImage(im);}
 else {if(!background && w!=DefaultRootWindow(d)){if(prop(DefaultRootWindow(d),"_NET_SUPPORTING_WM_CHECK")){XEvent event={0};event.xclient.type=ClientMessage;event.xclient.window=w;event.xclient.message_type=XInternAtom(d,"_NET_ACTIVE_WINDOW",False);event.xclient.format=32;event.xclient.data.l[0]=2;event.xclient.data.l[1]=CurrentTime;XSendEvent(d,DefaultRootWindow(d),False,SubstructureRedirectMask|SubstructureNotifyMask,&event);XFlush(d);}XRaiseWindow(d,w);XSetInputFocus(d,w,RevertToParent,CurrentTime);XSync(d,False);}
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
 else if((!strcmp(argv[1],"keyDown")||!strcmp(argv[1],"keyUp"))&&argc==4){KeySym sym=XStringToKeysym(argv[3]);KeyCode code=XKeysymToKeycode(d,sym);if(!code||background)return 2;XTestFakeKeyEvent(d,code,!strcmp(argv[1],"keyDown"),CurrentTime);if(persistent)heldKeys[code]=!strcmp(argv[1],"keyDown");}
 else if((!strcmp(argv[1],"buttonDown")||!strcmp(argv[1],"buttonUp"))&&argc==4){int b=atoi(argv[3]);if(b<1||b>3||background)return 2;XTestFakeButtonEvent(d,b,!strcmp(argv[1],"buttonDown"),CurrentTime);if(persistent)heldButtons[b]=!strcmp(argv[1],"buttonDown");}
 else if(!strcmp(argv[1],"key")&&argc==4){if(background)return 2;stroke(argv[3]);}
 else if((!strcmp(argv[1],"scroll")||!strcmp(argv[1],"scrollX"))&&argc==4){if(background)return 2;int amount=atoi(argv[3]);if(amount < -30||amount>30)return 2;for(int i=0;i<abs(amount)&&!cancelled;i++){XTestFakeButtonEvent(d,!strcmp(argv[1],"scrollX")?(amount>0?7:6):(amount>0?5:4),True,CurrentTime);XTestFakeButtonEvent(d,!strcmp(argv[1],"scrollX")?(amount>0?7:6):(amount>0?5:4),False,CurrentTime);}}
 else if(!strcmp(argv[1],"type")&&(argc==4||argc==5)){
   if(background)return 2;
   if(!clipboardOwner)clipboardOwner=XCreateSimpleWindow(d,DefaultRootWindow(d),0,0,1,1,0,0,0);
   free(clipboardText);clipboardText=strdup(argv[3]);if(!clipboardText)return 2;clipboardDelivered=0;
   Atom clipboard=XInternAtom(d,"CLIPBOARD",False);XSetSelectionOwner(d,clipboard,clipboardOwner,CurrentTime);
   if(argc==5&&!strcmp(argv[4],"Shift_L+Insert"))XSetSelectionOwner(d,XA_PRIMARY,clipboardOwner,CurrentTime);
   XSync(d,False);
   if(XGetSelectionOwner(d,clipboard)!=clipboardOwner)return 2;
   stroke(argc==5?argv[4]:"Control_L+v");
   long long started=nanos(),last=started;int wasDelivered=0;
   while(!cancelled && nanos()-started<3000000000LL){
    clipboardEvents();if(clipboardDelivered&&!wasDelivered){last=nanos();wasDelivered=1;}
    if(clipboardDelivered&&(persistent||nanos()-last>300000000LL))break;
    fd_set fds;FD_ZERO(&fds);FD_SET(ConnectionNumber(d),&fds);struct timeval timeout={0,10000};select(ConnectionNumber(d)+1,&fds,NULL,NULL,&timeout);
   }
   if(!clipboardDelivered)return 2;

 }
 else { return 2; }
 XSync(d,False);}}
 else { return 2; }
 if(!persistent)releaseInput();
 return cancelled?3:0;}

/* Private stdin/stdout protocol: request [bytes,id,argc,(bytes,arg)*], response [id,status,bytes,payload]. */
static int readAll(void *buffer,size_t count){unsigned char *p=buffer;while(count&&!cancelled){ssize_t n=read(0,p,count);if(n<0&&errno==EINTR)continue;if(n<=0)return 0;p+=n;count-=n;}return !count;}
int main(int argc,char **argv){
 if(argc<2)return 2;
 pid_t parent=getppid();if(prctl(PR_SET_PDEATHSIG,SIGTERM)==-1||getppid()!=parent)return 3;
 d=XOpenDisplay(NULL);if(!d){fprintf(stderr,"No X11 display\n");return 2;}XSetErrorHandler(fail);signal(SIGTERM,cancelInput);signal(SIGINT,cancelInput);signal(SIGPIPE,SIG_IGN);atexit(releaseInput);
 background=getenv("CU_INPUT_DELIVERY")&&!strcmp(getenv("CU_INPUT_DELIVERY"),"background");output=stdout;persistent=!strcmp(argv[1],"serve");
 if(!persistent){int status=dispatch(argc,argv);releaseInput();XCloseDisplay(d);d=NULL;return status;}
 while(!cancelled){
  clipboardEvents();fd_set fds;FD_ZERO(&fds);FD_SET(0,&fds);FD_SET(ConnectionNumber(d),&fds);int max=ConnectionNumber(d);struct timeval wait={0,100000};int ready=select(max+1,&fds,NULL,NULL,&wait);if(ready<0){if(errno==EINTR)continue;break;}if(!FD_ISSET(0,&fds))continue;
  uint32_t len;if(!readAll(&len,4))break;len=ntohl(len);if(len<8||len>128000)break;unsigned char *body=malloc(len);if(!body||!readAll(body,len)){free(body);break;}
  uint32_t id,number;memcpy(&id,body,4);memcpy(&number,body+4,4);number=ntohl(number);char *args[17]={"cu-x11"};size_t offset=8;int valid=number>0&&number<=15;
  for(unsigned i=0;valid&&i<number;i++){uint32_t n;if(offset+4>len){valid=0;break;}memcpy(&n,body+offset,4);n=ntohl(n);offset+=4;if(n>32000||offset+n>len||memchr(body+offset,0,n)){valid=0;break;}args[i+1]=malloc(n+1);if(!args[i+1]){valid=0;break;}memcpy(args[i+1],body+offset,n);args[i+1][n]=0;offset+=n;}
  if(offset!=len)valid=0;
  char *result=NULL;size_t size=0;output=open_memstream(&result,&size);if(!output)exit(2);int status=valid?dispatch(number+1,args):2;fclose(output);output=stdout;
  uint32_t header[]={id,htonl(status),htonl(size)};int ok=size<=80000000&&fwrite(header,1,12,stdout)==12&&fwrite(result,1,size,stdout)==size&&fflush(stdout)==0;free(result);free(body);for(unsigned i=1;i<=15;i++)free(args[i]);if(!ok)break;
 }
 releaseInput();free(clipboardText);XCloseDisplay(d);d=NULL;return cancelled?3:0;
}
