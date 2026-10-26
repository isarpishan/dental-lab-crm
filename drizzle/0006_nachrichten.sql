CREATE TABLE "ddl"."message_files" (
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "message_files_message_id_file_id_pk" PRIMARY KEY("message_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "ddl"."message_reads" (
	"order_id" uuid NOT NULL,
	"reader_kind" text NOT NULL,
	"reader_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_reads_order_id_reader_kind_reader_id_pk" PRIMARY KEY("order_id","reader_kind","reader_id")
);
--> statement-breakpoint
ALTER TABLE "ddl"."message_files" ADD CONSTRAINT "message_files_message_id_order_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "ddl"."order_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."message_files" ADD CONSTRAINT "message_files_file_id_order_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "ddl"."order_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl"."message_reads" ADD CONSTRAINT "message_reads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ddl"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_files_file_idx" ON "ddl"."message_files" USING btree ("file_id");