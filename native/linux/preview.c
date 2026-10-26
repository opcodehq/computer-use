/* Display-only GTK preview; cancellation is a single JSONL event to the owner. */
#include <gtk/gtk.h>
#include <json-glib/json-glib.h>
#include <stdio.h>
static GtkWidget *window,*image;
static gboolean stopped=FALSE;
static gboolean capture_ready(gpointer nonce){printf("{\"captureReady\":\"%s\"}\n",(char*)nonce);fflush(stdout);g_free(nonce);return G_SOURCE_REMOVE;}
static void stop(void){if(!stopped){stopped=TRUE;puts("{\"stop\":true}");fflush(stdout);}gtk_widget_hide(window);}
static gboolean deleted(GtkWidget *w,GdkEvent *e,gpointer data){(void)w;(void)e;(void)data;stop();return TRUE;}
static gboolean drag(GtkWidget *w,GdkEventButton *e,gpointer data){(void)data;if(e->button==1)gtk_window_begin_move_drag(GTK_WINDOW(w),e->button,e->x_root,e->y_root,e->time);return TRUE;}
static gboolean packet(GIOChannel *channel,GIOCondition condition,gpointer data){
 (void)data;if(condition&(G_IO_HUP|G_IO_ERR)){gtk_main_quit();return FALSE;}
 gchar *line=NULL;gsize length=0;GIOStatus status=g_io_channel_read_line(channel,&line,&length,NULL,NULL);
 if(status!=G_IO_STATUS_NORMAL){g_free(line);return TRUE;}
 JsonParser *parser=json_parser_new();
 if(length<12000000&&json_parser_load_from_data(parser,line,length,NULL)&&JSON_NODE_HOLDS_OBJECT(json_parser_get_root(parser))){
  JsonObject *o=json_node_get_object(json_parser_get_root(parser));
  if(json_object_has_member(o,"capture")){
   const char *nonce=json_object_get_string_member(o,"capture");
   if(nonce&&g_regex_match_simple("^[a-f0-9-]{36}$",nonce,0,0)){gtk_widget_hide(window);gdk_display_sync(gtk_widget_get_display(window));g_timeout_add(25,capture_ready,g_strdup(nonce));}
   g_object_unref(parser);g_free(line);return TRUE;
  }
  if(json_object_has_member(o,"state")&&!strcmp(json_object_get_string_member(o,"state"),"resumed"))stopped=FALSE;
  if(json_object_has_member(o,"image")&&json_object_get_member(o,"image")&&JSON_NODE_HOLDS_VALUE(json_object_get_member(o,"image"))&&json_node_get_value_type(json_object_get_member(o,"image"))==G_TYPE_STRING&&!stopped){
   const char *encoded=json_object_get_string_member(o,"image");gsize bytes;guchar *png=g_base64_decode(encoded,&bytes);GdkPixbufLoader *loader=gdk_pixbuf_loader_new();
   if(gdk_pixbuf_loader_write(loader,png,bytes,NULL)&&gdk_pixbuf_loader_close(loader,NULL)){
    GdkPixbuf *pixbuf=gdk_pixbuf_loader_get_pixbuf(loader);if(pixbuf){int w=gdk_pixbuf_get_width(pixbuf),h=gdk_pixbuf_get_height(pixbuf);int width=MIN(480,w),height=MAX(1,h*width/MAX(1,w));GdkPixbuf *scaled=gdk_pixbuf_scale_simple(pixbuf,width,height,GDK_INTERP_BILINEAR);gtk_image_set_from_pixbuf(GTK_IMAGE(image),scaled);g_object_unref(scaled);gtk_widget_show_all(window);}
   }g_object_unref(loader);g_free(png);
  }else gtk_widget_hide(window);
 }
 g_object_unref(parser);g_free(line);return TRUE;
}
int main(int argc,char **argv){
 if(!gtk_init_check(&argc,&argv))return 2;
 window=gtk_window_new(GTK_WINDOW_TOPLEVEL);gtk_window_set_title(GTK_WINDOW(window),"Opcode CU Preview");gtk_window_set_decorated(GTK_WINDOW(window),FALSE);gtk_window_set_accept_focus(GTK_WINDOW(window),FALSE);gtk_window_set_focus_on_map(GTK_WINDOW(window),FALSE);gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window),TRUE);gtk_window_set_keep_above(GTK_WINDOW(window),TRUE);gtk_window_set_type_hint(GTK_WINDOW(window),GDK_WINDOW_TYPE_HINT_UTILITY);
 GtkWidget *box=gtk_box_new(GTK_ORIENTATION_VERTICAL,0);gtk_container_add(GTK_CONTAINER(window),box);image=gtk_image_new();gtk_box_pack_start(GTK_BOX(box),image,TRUE,TRUE,0);
 GtkWidget *cancel=gtk_button_new_with_label("Opcode • Cancel");gtk_box_pack_end(GTK_BOX(box),cancel,FALSE,FALSE,0);g_signal_connect(cancel,"clicked",G_CALLBACK(stop),NULL);g_signal_connect(window,"delete-event",G_CALLBACK(deleted),NULL);gtk_widget_add_events(window,GDK_BUTTON_PRESS_MASK);g_signal_connect(window,"button-press-event",G_CALLBACK(drag),NULL);
 GIOChannel *channel=g_io_channel_unix_new(0);g_io_channel_set_encoding(channel,NULL,NULL);g_io_add_watch(channel,G_IO_IN|G_IO_HUP|G_IO_ERR,packet,NULL);gtk_main();g_io_channel_unref(channel);return 0;
}
