// SPDX-License-Identifier: MIT
// File-based .NET app used by @aphrody/bun-loaders: describe or invoke public members of an assembly.
#:property PublishAot=false
#:property JsonSerializerIsReflectionEnabledByDefault=true
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Text.Json.Nodes;

var options = new JsonSerializerOptions { IncludeFields = true };
if (args.Length < 2) { Console.Error.WriteLine("usage: reflect describe|invoke <dll> [type method json]"); return 2; }
var asm = new AssemblyLoadContext("bun-loaders", true).LoadFromAssemblyPath(Path.GetFullPath(args[1]));

string Name(Type t) => t.IsGenericType
    ? $"{t.Name[..t.Name.IndexOf('`')]}<{string.Join(",", t.GetGenericArguments().Select(Name))}>"
    : t.Name;

if (args[0] == "describe")
{
    const BindingFlags Public = BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly;
    var types = asm.GetExportedTypes().Select(t => (JsonNode)new JsonObject
    {
        ["name"] = t.FullName,
        ["kind"] = t.IsEnum ? "enum" : t.IsInterface ? "interface" : t.IsValueType ? "struct" : "class",
        ["static"] = t.IsAbstract && t.IsSealed,
        ["methods"] = new JsonArray(t.GetMethods(Public).Where(m => !m.IsSpecialName).Select(m => (JsonNode)new JsonObject
        {
            ["name"] = m.Name,
            ["static"] = m.IsStatic,
            ["returns"] = Name(m.ReturnType),
            ["parameters"] = new JsonArray(m.GetParameters().Select(p => (JsonNode)new JsonObject
            {
                ["name"] = p.Name, ["type"] = Name(p.ParameterType), ["optional"] = p.IsOptional,
            }).ToArray()),
        }).ToArray()),
        ["properties"] = new JsonArray(t.GetProperties(Public).Select(p => (JsonNode)new JsonObject
        {
            ["name"] = p.Name, ["type"] = Name(p.PropertyType), ["static"] = p.GetMethod?.IsStatic ?? false,
        }).ToArray()),
        ["fields"] = new JsonArray(t.GetFields(Public).Where(f => !f.IsSpecialName).Select(f => (JsonNode)new JsonObject
        {
            ["name"] = f.Name, ["type"] = Name(f.FieldType), ["static"] = f.IsStatic,
            ["value"] = f.IsLiteral ? JsonSerializer.SerializeToNode(f.GetRawConstantValue(), options) : null,
        }).ToArray()),
    }).ToArray();
    var name = asm.GetName();
    Console.WriteLine(new JsonObject { ["assembly"] = name.Name, ["version"] = name.Version?.ToString(), ["types"] = new JsonArray(types) }.ToJsonString());
    return 0;
}

if (args[0] == "invoke" && args.Length >= 5)
{
    var type = asm.GetType(args[2], true)!;
    var input = JsonNode.Parse(args[4]) as JsonArray ?? [];
    var method = type.GetMethods(BindingFlags.Public | BindingFlags.Static)
        .Where(m => m.Name == args[3])
        .FirstOrDefault(m => m.GetParameters().Length >= input.Count && m.GetParameters().Skip(input.Count).All(p => p.IsOptional))
        ?? throw new MissingMethodException(args[2], args[3]);
    var values = method.GetParameters()
        .Select((p, i) => i < input.Count ? input[i].Deserialize(p.ParameterType, options) : p.DefaultValue)
        .ToArray();
    var result = method.Invoke(null, values);
    if (result is Task task)
    {
        await task;
        var prop = task.GetType().GetProperty("Result");
        result = prop is null || prop.PropertyType.Name == "VoidTaskResult" ? null : prop.GetValue(task);
    }
    Console.WriteLine(JsonSerializer.Serialize(result, options));
    return 0;
}

Console.Error.WriteLine($"unknown command {args[0]}");
return 2;
