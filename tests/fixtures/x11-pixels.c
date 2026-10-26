#define main nativeHelperMain
#include "../../native/linux/x11.c"
#undef main
#include <assert.h>
int main(void) {
 for(int bits=16;bits<=32;bits+=8)for(int order=0;order<=1;order++) {
  unsigned char bytes[64]={0};XImage im={0};im.width=3;im.height=2;im.format=ZPixmap;im.data=(char*)bytes;im.byte_order=order;im.bitmap_unit=32;im.bitmap_bit_order=LSBFirst;im.bitmap_pad=32;im.depth=bits==32?24:bits;im.bits_per_pixel=bits;im.bytes_per_line=16;
  im.red_mask=bits==16?0xf800:0xff0000;im.green_mask=bits==16?0x7e0:0xff00;im.blue_mask=bits==16?0x1f:0xff;
  assert(XInitImage(&im));
  unsigned long colors[]={im.red_mask,im.green_mask,im.blue_mask,im.red_mask|im.green_mask|im.blue_mask,0,0};
  for(int y=0;y<2;y++)for(int x=0;x<3;x++){unsigned long p=colors[y*3+x];unsigned char *b=bytes+y*16+x*bits/8;for(int i=0;i<bits/8;i++)b[order==LSBFirst?i:bits/8-i-1]=(p>>(8*i))&255;}
  for(int y=0;y<2;y++)for(int x=0;x<3;x++){unsigned char actual[3];rgb(&im,x,y,actual);unsigned long pixel=XGetPixel(&im,x,y);assert(actual[0]==channel(pixel,im.red_mask));assert(actual[1]==channel(pixel,im.green_mask));assert(actual[2]==channel(pixel,im.blue_mask));assert(pixel==colors[y*3+x]);}
 }
 fprintf(stderr,"Pixel layouts passed: 16/24/32 bits, both byte orders, padded rows.\n");return 0;
}
