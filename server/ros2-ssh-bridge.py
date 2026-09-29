"""Ephemeral ROS 2 JSON bridge. Sent over SSH stdin/stdout; no robot files are written.

Only the rosbridge operations EasyLoop uses are implemented. Each WebSocket gets
its own ROS node and its subscriptions disappear when the connection closes.
"""

import json
import os
import queue
import sys
import threading
import time

import rclpy
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.utilities import get_message, get_service


incoming = queue.Queue()
output_lock = threading.Lock()


def send(value):
    with output_lock:
        sys.stdout.write(json.dumps(value, default=list, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def read_input():
    for line in sys.stdin:
        try:
            incoming.put(json.loads(line))
        except (ValueError, TypeError):
            continue
    incoming.put(None)


def graph_type(entries, name):
    return next((types[0] for topic, types in entries if topic == name and types), "")


def main():
    rclpy.init()
    node = rclpy.create_node("easyloop_bridge_{}".format(os.getpid()))
    robot_scope = "/" + os.environ.get("ROS_HOSTNAME", "").strip("/")
    if robot_scope != "/":
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            if any(namespace == robot_scope for _, namespace in node.get_node_names_and_namespaces()):
                break
            rclpy.spin_once(node, timeout_sec=0.1)
    subscriptions = {}
    publishers = {}
    clients = {}
    pending = []
    thread = threading.Thread(target=read_input, daemon=True)
    thread.start()
    send({"op": "status", "level": "info", "msg": "ROS2 bridge ready"})

    def respond(request, values, success=True):
        send({"op": "service_response", "service": request.get("service", ""),
              "id": request.get("id"), "result": success, "values": values})

    def rosapi(request):
        name = request.get("service", "").rsplit("/", 1)[-1]
        args = request.get("args") or {}
        topics = node.get_topic_names_and_types()
        services = node.get_service_names_and_types()
        if name == "topics":
            return {"topics": [item[0] for item in topics],
                    "types": [item[1][0] if item[1] else "" for item in topics]}
        if name == "services":
            return {"services": [item[0] for item in services]}
        if name == "nodes":
            return {"nodes": [namespace.rstrip("/") + "/" + node_name
                              for node_name, namespace in node.get_node_names_and_namespaces()]}
        if name == "get_param_names":
            # ROS 2 parameters belong to nodes. Do not present a synthetic
            # ROS 1 global parameter tree as an authoritative editable source.
            return {"names": []}
        if name == "topic_type":
            return {"type": graph_type(topics, args.get("topic", ""))}
        if name == "service_type":
            return {"type": graph_type(services, args.get("service", ""))}
        if name == "publishers":
            infos = node.get_publishers_info_by_topic(args.get("topic", ""))
            return {"publishers": [info.node_namespace.rstrip("/") + "/" + info.node_name
                                    for info in infos]}
        if name == "node_details":
            target = args.get("node", "")
            namespace, _, node_name = target.rpartition("/")
            namespace = namespace or "/"
            return {
                "publishing": [name for name, _ in node.get_publisher_names_and_types_by_node(node_name, namespace)],
                "subscribing": [name for name, _ in node.get_subscriber_names_and_types_by_node(node_name, namespace)],
                "services": [name for name, _ in node.get_service_names_and_types_by_node(node_name, namespace)]
            }
        if name == "get_param":
            # ROS 2 has node-local parameters. A ROS 1-style global parameter
            # name cannot be inferred safely from a graph snapshot.
            return {"value": "null"}
        raise ValueError("Unsupported rosapi operation: " + name)

    def handle(request):
        operation = request.get("op")
        if operation == "call_service":
            service = request.get("service", "")
            try:
                if service.startswith("/rosapi/"):
                    respond(request, rosapi(request))
                    return
                graph_name = graph_type(node.get_service_names_and_types(), service)
                requested_name = request.get("type") or ""
                type_name = requested_name if "/srv/" in requested_name else graph_name
                if not type_name or "/srv/" not in type_name:
                    raise ValueError("ROS2 service type unavailable: " + service)
                key = (service, type_name)
                if len(clients) >= 64 and key not in clients:
                    raise ValueError("ROS2 service client limit reached")
                if len(pending) >= 32:
                    raise ValueError("ROS2 pending service call limit reached")
                client = clients.get(key)
                if client is None:
                    client = node.create_client(get_service(type_name), service)
                    clients[key] = client
                if not client.wait_for_service(timeout_sec=0.2):
                    raise ValueError("ROS2 service unavailable: " + service)
                call = get_service(type_name).Request()
                set_message_fields(call, request.get("args") or {})
                pending.append((request, client.call_async(call)))
            except Exception as error:
                respond(request, {"message": str(error)}, False)
            return

        if operation == "subscribe":
            topic = request.get("topic", "")
            sub_id = request.get("id") or topic
            if sub_id in subscriptions:
                return
            try:
                if len(subscriptions) >= 96:
                    raise ValueError("ROS2 subscription limit reached")
                graph_name = graph_type(node.get_topic_names_and_types(), topic)
                requested_name = request.get("type") or ""
                type_name = requested_name if "/msg/" in requested_name else graph_name
                if not type_name or "/msg/" not in type_name:
                    raise ValueError("ROS2 topic type unavailable: " + topic)
                qos = QoSProfile(depth=10, reliability=ReliabilityPolicy.BEST_EFFORT)
                if topic.endswith("/map") or topic.endswith("/tf_static"):
                    qos.durability = DurabilityPolicy.TRANSIENT_LOCAL
                throttle = max(0, int(request.get("throttle_rate") or 0)) / 1000.0
                last_sent = [0.0]

                def on_message(message):
                    now = time.monotonic()
                    if throttle and now - last_sent[0] < throttle:
                        return
                    last_sent[0] = now
                    send({"op": "publish", "topic": topic,
                          "msg": message_to_ordereddict(message)})

                subscriptions[sub_id] = node.create_subscription(
                    get_message(type_name), topic, on_message, qos)
            except Exception as error:
                send({"op": "status", "level": "error", "msg": str(error), "id": sub_id})
            return

        if operation == "unsubscribe":
            sub_id = request.get("id") or request.get("topic")
            subscription = subscriptions.pop(sub_id, None)
            if subscription:
                node.destroy_subscription(subscription)
            return

        if operation in ("advertise", "unadvertise"):
            return
        if operation == "publish":
            topic = request.get("topic", "")
            try:
                if topic.endswith("/cmd_vel") or topic.endswith("/cmd_vel_selected"):
                    raise ValueError("publish through cmd_vel_teleop so the safety gate remains in path")
                graph_name = graph_type(node.get_topic_names_and_types(), topic)
                requested_name = request.get("type") or ""
                type_name = requested_name if "/msg/" in requested_name else graph_name
                if not type_name or "/msg/" not in type_name:
                    raise ValueError("ROS2 publish type unavailable: " + topic)
                key = (topic, type_name)
                publisher = publishers.get(key)
                if publisher is None:
                    publisher = node.create_publisher(get_message(type_name), topic, 10)
                    publishers[key] = publisher
                message = get_message(type_name)()
                set_message_fields(message, request.get("msg") or {})
                publisher.publish(message)
            except Exception as error:
                send({"op": "status", "level": "error", "msg": str(error),
                      "id": request.get("id")})

    try:
        while rclpy.ok():
            try:
                item = incoming.get(timeout=0.02)
                if item is None:
                    break
                handle(item)
                while True:
                    item = incoming.get_nowait()
                    if item is None:
                        return
                    handle(item)
            except queue.Empty:
                pass
            for request, future in pending[:]:
                if future.done():
                    pending.remove((request, future))
                    try:
                        respond(request, message_to_ordereddict(future.result()))
                    except Exception as error:
                        respond(request, {"message": str(error)}, False)
            rclpy.spin_once(node, timeout_sec=0.01)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
