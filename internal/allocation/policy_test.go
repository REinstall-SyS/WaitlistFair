package allocation
import("testing";"time")
func instant(s string)time.Time{t,e:=time.Parse(time.RFC3339,s);if e!=nil{panic(e)};return t}
func TestAvailability(t *testing.T){tests:=[]struct{name,start,end,from,until string;day int;want bool}{
 {"normal","2026-11-18T15:00:00Z","2026-11-18T15:45:00Z","09:00","10:00",3,true},
 {"seconds beyond boundary","2026-11-18T15:00:00Z","2026-11-18T16:00:01Z","09:00","10:00",3,false},
 {"wrong day","2026-11-18T15:00:00Z","2026-11-18T15:45:00Z","09:00","10:00",2,false},
 {"first folded hour","2026-11-01T06:00:00Z","2026-11-01T06:30:00Z","01:00","02:00",0,true},
 {"second folded hour","2026-11-01T07:00:00Z","2026-11-01T07:30:00Z","01:00","02:00",0,true},
 {"fold crosses unavailable time","2026-11-01T06:45:00Z","2026-11-01T07:45:00Z","01:30","02:00",0,false},
 {"spring gap","2026-03-08T07:30:00Z","2026-03-08T08:30:00Z","01:00","04:00",0,true},
 {"spring nonexistent window","2026-03-08T08:00:00Z","2026-03-08T08:30:00Z","02:00","03:00",0,false},
 };for _,test:=range tests{t.Run(test.name,func(t *testing.T){p:=Preferences{Timezone:"America/Chicago",Windows:[]Window{{Day:test.day,Start:test.from,End:test.until}}};if got:=p.Match(instant(test.start),instant(test.end));got!=test.want{t.Fatalf("got %v want %v",got,test.want)}})}}
func TestFIFO(t *testing.T){now:=instant("2026-11-18T15:00:00Z");prefs:=Preferences{Timezone:"UTC",Windows:[]Window{{Day:3,Start:"00:00",End:"23:59"}}};c:=[]Candidate{{ID:"b",JoinedAt:now,Preferences:prefs},{ID:"a",JoinedAt:now,Preferences:prefs},{ID:"first-but-ineligible",JoinedAt:now.Add(-time.Hour),Preferences:prefs,Reasons:[]string{"previous_offer"}}};eligible,x:=Explain(c,now,now.Add(time.Hour),now,"calculus");if len(eligible)!=2||eligible[0].ID!="a"||x.Considered!=3||x.Excluded!=1||x.Reasons["previous_offer"]!=1{t.Fatalf("unexpected selection %+v %+v",eligible,x)}}
func TestInvalidPreferences(t *testing.T){for _,p:=range []Preferences{{Timezone:"invalid"},{Timezone:"UTC"},{Timezone:"UTC",Windows:[]Window{{Day:8,Start:"09:00",End:"10:00"}}},{Timezone:"UTC",Windows:[]Window{{Day:1,Start:"18:00",End:"09:00"}}}}{if p.Validate()==nil{t.Fatalf("accepted invalid preferences %+v",p)}}}
