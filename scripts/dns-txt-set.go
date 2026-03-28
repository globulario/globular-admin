// dns-txt-set: Set or remove a TXT record in the Globular DNS service.
// Used as a certbot DNS-01 challenge hook.
//
// Usage:
//   dns-txt-set set  <domain> <value> [ttl]
//   dns-txt-set del  <domain> <value>
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"os"
	"strconv"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"

	dnspb "github.com/globulario/services/golang/dns/dnspb"
)

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintf(os.Stderr, "Usage: %s set|del <domain> <value> [ttl]\n", os.Args[0])
		os.Exit(1)
	}

	action := os.Args[1]
	domain := os.Args[2]
	value := os.Args[3]
	ttl := uint32(60)
	if len(os.Args) > 4 {
		if v, err := strconv.Atoi(os.Args[4]); err == nil {
			ttl = uint32(v)
		}
	}

	addr := "127.0.0.1:10006"
	creds := credentials.NewTLS(&tls.Config{InsecureSkipVerify: true})
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(creds))
	if err != nil {
		fmt.Fprintf(os.Stderr, "dial: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close()

	client := dnspb.NewDnsServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	switch action {
	case "set":
		_, err = client.SetTXT(ctx, &dnspb.SetTXTRequest{
			Domain: domain,
			Txt:    value,
			Ttl:    ttl,
		})
	case "del":
		_, err = client.RemoveTXT(ctx, &dnspb.RemoveTXTRequest{
			Domain: domain,
			Txt:    value,
		})
	default:
		fmt.Fprintf(os.Stderr, "unknown action: %s\n", action)
		os.Exit(1)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "%s %s: %v\n", action, domain, err)
		os.Exit(1)
	}
	fmt.Printf("%s %s OK\n", action, domain)
}
