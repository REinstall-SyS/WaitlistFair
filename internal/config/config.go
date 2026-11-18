package config

import("fmt";"net/url";"os";"strings")
type Config struct{ DatabaseURL,Addr,AppURL,SMTPAddr,SMTPUser,SMTPPassword,MailFrom string; Production bool }
func Load()(Config,error){c:=Config{DatabaseURL:os.Getenv("DATABASE_URL"),Addr:env("API_ADDR",":8080"),AppURL:strings.TrimSuffix(env("APP_URL","http://localhost:3000"),"/"),SMTPAddr:env("SMTP_ADDR","localhost:1025"),SMTPUser:os.Getenv("SMTP_USER"),SMTPPassword:os.Getenv("SMTP_PASSWORD"),MailFrom:env("MAIL_FROM","WaitlistFair <hello@waitlistfair.local>"),Production:os.Getenv("APP_ENV")=="production"};if c.DatabaseURL==""{return c,fmt.Errorf("DATABASE_URL is required")};u,e:=url.Parse(c.AppURL);if e!=nil||u.Host==""||(u.Scheme!="http"&&u.Scheme!="https"){return c,fmt.Errorf("invalid APP_URL")};if c.Production&&u.Scheme!="https"{return c,fmt.Errorf("production APP_URL requires HTTPS")};return c,nil}
func env(key,fallback string)string{if v:=os.Getenv(key);v!=""{return v};return fallback}
