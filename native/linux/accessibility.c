/* AT-SPI is optional. JSONL over a private child pipe; never opens a socket. */
#include <atspi/atspi.h>
#include <json-glib/json-glib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static GPtrArray *refs;
static gchar *snapshot_id;
static guint selected_pid;
static gint64 observed_at;
static JsonBuilder *b;
static gboolean clipped=FALSE;
static const char *str(JsonObject *o,const char *key){return json_object_has_member(o,key)?json_object_get_string_member(o,key):"";}
static void member(const char *k,const char *v){json_builder_set_member_name(b,k);json_builder_add_string_value(b,v?v:"");}
static void boolean(const char *k,gboolean v){json_builder_set_member_name(b,k);json_builder_add_boolean_value(b,v);}
static void number(const char *k,gint64 v){json_builder_set_member_name(b,k);json_builder_add_int_value(b,v);}
static const char *role_name(AtspiRole role){switch(role){case ATSPI_ROLE_PUSH_BUTTON:return "AXButton";case ATSPI_ROLE_ENTRY:case ATSPI_ROLE_TEXT:case ATSPI_ROLE_PASSWORD_TEXT:return "AXTextField";case ATSPI_ROLE_LABEL:return "AXStaticText";case ATSPI_ROLE_FRAME:case ATSPI_ROLE_DIALOG:return "AXWindow";case ATSPI_ROLE_CHECK_BOX:return "AXCheckBox";case ATSPI_ROLE_COMBO_BOX:return "AXComboBox";case ATSPI_ROLE_MENU_ITEM:return "AXMenuItem";default:return "AXGroup";}}
static void walk(AtspiAccessible *a,int depth,int limit){
 if(!a){clipped=TRUE;return;}
 if(depth>30||(int)refs->len>=limit){clipped=TRUE;return;}
 AtspiStateSet *states=atspi_accessible_get_state_set(a);if(!states){clipped=TRUE;return;}
 if(atspi_state_set_contains(states,ATSPI_STATE_DEFUNCT)){g_object_unref(states);return;}
 gchar *name=atspi_accessible_get_name(a,NULL);if(name&&g_utf8_strlen(name,-1)>2000){gchar *short_name=g_utf8_substring(name,0,2000);g_free(name);name=short_name;clipped=TRUE;}AtspiRole role=atspi_accessible_get_role(a,NULL);
 gboolean secure=role==ATSPI_ROLE_PASSWORD_TEXT;
 AtspiText *text=secure?NULL:atspi_accessible_get_text_iface(a);
 int characters=text?atspi_text_get_character_count(text,NULL):0;if(characters>2000||characters<0)clipped=TRUE;
 gchar *value=text?atspi_text_get_text(text,0,MIN(2000,MAX(0,characters)),NULL):NULL;
 gchar *ref=g_strdup_printf("%s:%u",snapshot_id,refs->len);g_ptr_array_add(refs,g_object_ref(a));
 json_builder_begin_object(b);member("ref",ref);member("role",role_name(role));member("name",name);member("value",secure?"[secure]":value);
 boolean("enabled",atspi_state_set_contains(states,ATSPI_STATE_ENABLED));boolean("visible",atspi_state_set_contains(states,ATSPI_STATE_VISIBLE));boolean("focused",atspi_state_set_contains(states,ATSPI_STATE_FOCUSED));number("depth",depth);
 json_builder_set_member_name(b,"actions");json_builder_begin_array(b);
 if(!secure){if(atspi_accessible_get_action_iface(a))json_builder_add_string_value(b,"AXPress");if(atspi_accessible_get_editable_text_iface(a))json_builder_add_string_value(b,"setValue");}
 json_builder_end_array(b);
 AtspiComponent *component=atspi_accessible_get_component_iface(a);
 if(component){AtspiRect *r=atspi_component_get_extents(component,ATSPI_COORD_TYPE_SCREEN,NULL);if(r){json_builder_set_member_name(b,"frame");json_builder_begin_object(b);number("x",r->x);number("y",r->y);number("width",MAX(0,r->width));number("height",MAX(0,r->height));json_builder_end_object(b);g_free(r);}}
 json_builder_end_object(b);g_free(ref);g_free(name);g_free(value);g_object_unref(states);
 int count=atspi_accessible_get_child_count(a,NULL);if(count<0)clipped=TRUE;for(int i=0;i<count&&(int)refs->len<limit;i++){AtspiAccessible *child=atspi_accessible_get_child_at_index(a,i,NULL);walk(child,depth+1,limit);if(child)g_object_unref(child);}
}
static AtspiAccessible *find_window(guint pid,const char *title){
 AtspiAccessible *desktop=atspi_get_desktop(0),*found=NULL;int matches=0;
 if(!desktop)return NULL;
 int count=atspi_accessible_get_child_count(desktop,NULL);
 for(int i=0;i<count;i++){AtspiAccessible *app=atspi_accessible_get_child_at_index(desktop,i,NULL);if(!app)continue;
  if(atspi_accessible_get_process_id(app,NULL)==pid){int n=atspi_accessible_get_child_count(app,NULL);for(int j=0;j<n;j++){AtspiAccessible *window=atspi_accessible_get_child_at_index(app,j,NULL);if(!window)continue;gchar *name=atspi_accessible_get_name(window,NULL);if(g_strcmp0(name,title)==0){matches++;if(!found)found=g_object_ref(window);}g_free(name);g_object_unref(window);}}
  g_object_unref(app);
 }
 g_object_unref(desktop);if(matches!=1){if(found)g_object_unref(found);return NULL;}return found;
}
static const char *handle(JsonObject *o){
 const char *method=str(o,"method");
 if(!strcmp(method,"status")){boolean("available",atspi_get_desktop_count()>0);return NULL;}
 if(!strcmp(method,"snapshot")){
  selected_pid=json_object_get_int_member(o,"pid");AtspiAccessible *window=find_window(selected_pid,str(o,"title"));
  if(!window)return "Accessibility window unavailable or ambiguous.";
  clipped=FALSE;g_ptr_array_set_size(refs,0);g_free(snapshot_id);snapshot_id=g_uuid_string_random();observed_at=g_get_monotonic_time();
  member("id",snapshot_id);member("source","ax");member("accessibilityBackend","atspi");number("pid",selected_pid);member("title",str(o,"title"));number("windowId",json_object_get_int_member(o,"windowId"));
  json_builder_set_member_name(b,"nodes");json_builder_begin_array(b);walk(window,0,1000);json_builder_end_array(b);boolean("truncated",clipped||refs->len>=1000);g_object_unref(window);return NULL;
 }
 if(!strcmp(method,"execute")||!strcmp(method,"check")){
  if(!snapshot_id||strcmp(str(o,"snapshotId"),snapshot_id)||g_get_monotonic_time()-observed_at>30000000)return "Stale accessibility snapshot.";
  JsonObject *action=json_object_get_object_member(o,"action");const char *ref=str(action,"ref");gchar *prefix=g_strdup_printf("%s:",snapshot_id);
  if(!g_str_has_prefix(ref,prefix)){g_free(prefix);return "Stale accessibility ref.";}
  const char *index=ref+strlen(prefix);char *end;unsigned long i=strtoul(index,&end,10);g_free(prefix);if(!*index||*end||i>=refs->len)return "Unknown accessibility ref.";
  AtspiAccessible *a=g_ptr_array_index(refs,i);AtspiStateSet *states=atspi_accessible_get_state_set(a);
  gboolean ready=states&&!atspi_state_set_contains(states,ATSPI_STATE_DEFUNCT)&&atspi_state_set_contains(states,ATSPI_STATE_ENABLED)&&atspi_accessible_get_process_id(a,NULL)==selected_pid;
  if(states)g_object_unref(states);
  if(!ready)return "Accessibility target changed.";
  if(atspi_accessible_get_role(a,NULL)==ATSPI_ROLE_PASSWORD_TEXT)return "Secret entry requires the host.";
  if(!strcmp(method,"check")){
   states=atspi_accessible_get_state_set(a);boolean("focused",states&&atspi_state_set_contains(states,ATSPI_STATE_FOCUSED));if(states)g_object_unref(states);
   AtspiComponent *component=atspi_accessible_get_component_iface(a);AtspiRect *r=component?atspi_component_get_extents(component,ATSPI_COORD_TYPE_SCREEN,NULL):NULL;
   if(!r)return "Accessibility target geometry unavailable.";
   json_builder_set_member_name(b,"frame");json_builder_begin_object(b);number("x",r->x);number("y",r->y);number("width",MAX(0,r->width));number("height",MAX(0,r->height));json_builder_end_object(b);g_free(r);return NULL;
  }
  const char *operation=str(action,"kind");gboolean ok=FALSE;GError *error=NULL;
  /* Consume before calling the application. A failed call is never replayed here. */
  g_clear_pointer(&snapshot_id,g_free);
  if(!strcmp(operation,"press")){AtspiAction *act=atspi_accessible_get_action_iface(a);if(act&&atspi_action_get_n_actions(act,NULL)==1)ok=atspi_action_do_action(act,0,&error);}
  else if(!strcmp(operation,"setValue")){AtspiEditableText *text=atspi_accessible_get_editable_text_iface(a);if(text)ok=atspi_editable_text_set_text_contents(text,str(action,"text"),&error);}
  if(error)g_error_free(error);
  if(!ok)return "Accessibility dispatch unconfirmed.";
  member("delivery","dispatchedUnverified");return NULL;
 }
 return "Unsupported accessibility method.";
}
int main(void){
 if(atspi_init()!=0)return 2;
 atspi_set_timeout(1500,1500);refs=g_ptr_array_new_with_free_func(g_object_unref);
 char *line=NULL;size_t size=0;
 while(getline(&line,&size,stdin)>0){
  for(int events=0;events<100&&g_main_context_pending(NULL);events++)g_main_context_iteration(NULL,FALSE);
  JsonParser *parser=json_parser_new();const char *error=NULL;
  if(strlen(line)>120000||!json_parser_load_from_data(parser,line,-1,NULL)||!JSON_NODE_HOLDS_OBJECT(json_parser_get_root(parser)))error="Invalid accessibility request.";
  b=json_builder_new();json_builder_begin_object(b);
  if(!error)error=handle(json_node_get_object(json_parser_get_root(parser)));
  json_builder_end_object(b);
  if(error){g_object_unref(b);b=json_builder_new();json_builder_begin_object(b);member("error",error);json_builder_end_object(b);}
  JsonGenerator *generator=json_generator_new();JsonNode *root=json_builder_get_root(b);json_generator_set_root(generator,root);gchar *out=json_generator_to_data(generator,NULL);puts(out);fflush(stdout);
  g_free(out);json_node_free(root);g_object_unref(generator);g_object_unref(b);g_object_unref(parser);
 }
 free(line);g_ptr_array_unref(refs);g_free(snapshot_id);atspi_exit();return 0;
}
