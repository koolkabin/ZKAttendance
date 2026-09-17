using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZKAttendance.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DeviceType",
                table: "Devices",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeviceType",
                table: "Devices");
        }
    }
}
