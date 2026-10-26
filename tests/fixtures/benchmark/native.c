#include <gtk/gtk.h>
#include <stdio.h>
static GtkWidget *entry,*status;
static const char *output;
static void save(void){const char *text=gtk_entry_get_text(GTK_ENTRY(entry));FILE *f=fopen(output,"w");if(f){fputs(text,f);fclose(f);gtk_label_set_text(GTK_LABEL(status),"Saved and reopened");}}
int main(int argc,char **argv){if(argc!=2)return 2;output=argv[1];gtk_init(&argc,&argv);GtkWidget *window=gtk_window_new(GTK_WINDOW_TOPLEVEL);gtk_window_set_title(GTK_WINDOW(window),"Opcode workflow fixture");gtk_window_set_default_size(GTK_WINDOW(window),500,240);GtkWidget *box=gtk_box_new(GTK_ORIENTATION_VERTICAL,10);gtk_container_add(GTK_CONTAINER(window),box);entry=gtk_entry_new();atk_object_set_name(gtk_widget_get_accessible(entry),"Project name");gtk_box_pack_start(GTK_BOX(box),entry,FALSE,FALSE,10);GtkWidget *button=gtk_button_new_with_label("Save project");gtk_box_pack_start(GTK_BOX(box),button,FALSE,FALSE,10);status=gtk_label_new("Waiting");gtk_box_pack_start(GTK_BOX(box),status,FALSE,FALSE,10);g_signal_connect(button,"clicked",G_CALLBACK(save),NULL);g_signal_connect(window,"destroy",G_CALLBACK(gtk_main_quit),NULL);gtk_widget_show_all(window);gtk_main();return 0;}
